using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace VocabBattle.Api.Core;

public sealed record GenerateDeckInput(string? Topic, string? Level, int Count);
public sealed record SuggestPhrasesInput(string? Word);
public sealed record ExtractItemsInput(string? Passage, string? Level);
public sealed record DistractorItem(string? Type, string? Text, string? Meaning);
public sealed record DistractorsInput(List<DistractorItem>? Items);

/// <summary>Validated result of an AI task, plus the tokens it cost.</summary>
public sealed record AiTaskResult(JsonObject Value, AiUsage Usage);

/// <summary>
/// AI helpers for building decks. Prompts and schemas are fixed server-side (AiShared); the client
/// only sends data. Every output is schema-validated (StructuredService) and then trimmed to the deck limits.
/// </summary>
public sealed partial class AiTasksService(StructuredService structured, AiOptions options)
{
    public static readonly string[] ItemTypes = ["word", "collocation", "phrasal_verb", "idiom", "pattern"];
    public static readonly string[] Levels = ["A1", "A2", "B1", "B2", "C1", "C2"];
    public const int MaxSuggestions = 10;
    public const int MaxExtracted = 30;
    public const int MaxDistractorItems = 10;

    [GeneratedRegex(@"[\p{Cc}]")]
    private static partial Regex ControlChars();

    private static Limits L => AiShared.Limits;
    private static TaskPrompt Prompt(string name) => AiShared.Prompts.Tasks[name];

    /// <summary>Validate a request body before any rate limit or provider call; throws <see cref="InputException"/>.</summary>
    public static void Precheck(object? body)
    {
        switch (body)
        {
            case GenerateDeckInput g: CheckGenerateDeck(g); break;
            case SuggestPhrasesInput s: CheckWord(s); break;
            case ExtractItemsInput e: CheckExtract(e); break;
            case DistractorsInput d: CheckDistractors(d); break;
        }
    }

    private static (string Topic, string Level, int Count) CheckGenerateDeck(GenerateDeckInput? input)
    {
        var topic = CleanText(input?.Topic);
        if (topic.Length == 0 || topic.Length > L.GenerateDeck.MaxTopicLength)
            throw new InputException($"Chủ đề cần từ 1 đến {L.GenerateDeck.MaxTopicLength} ký tự.");
        var level = RequireLevel(input?.Level);
        var count = input?.Count ?? 0;
        if (count < L.GenerateDeck.MinCount || count > L.GenerateDeck.MaxCount)
            throw new InputException($"Số mục phải từ {L.GenerateDeck.MinCount} đến {L.GenerateDeck.MaxCount}.");
        return (topic, level, count);
    }

    private static string CheckWord(SuggestPhrasesInput? input) =>
        LookupService.NormalizeWord(input?.Word)
        ?? throw new InputException($"Từ phải là chữ cái tiếng Anh, tối đa {LookupService.MaxWordLength} ký tự.");

    private static (string Passage, string Level) CheckExtract(ExtractItemsInput? input)
    {
        var passage = ControlChars().Replace(input?.Passage ?? "", " ").Trim();
        if (passage.Length == 0 || passage.Length > L.ExtractItems.MaxPassageLength)
            throw new InputException($"Đoạn văn cần từ 1 đến {L.ExtractItems.MaxPassageLength} ký tự.");
        return (passage, RequireLevel(input?.Level));
    }

    private static JsonArray CheckDistractors(DistractorsInput? input)
    {
        var items = input?.Items ?? [];
        if (items.Count is 0 or > MaxDistractorItems) throw new InputException($"Cần từ 1 đến {MaxDistractorItems} mục.");
        var clean = new JsonArray();
        foreach (var it in items)
        {
            var type = it?.Type is { } t && ItemTypes.Contains(t) ? t : throw new InputException("Loại mục không hợp lệ.");
            var text = CleanText(it.Text);
            if (text.Length == 0 || text.Length > L.FieldLength.Text) throw new InputException("Từ/cụm từ không hợp lệ.");
            clean.Add(new JsonObject { ["type"] = type, ["text"] = text, ["meaning"] = Clip(CleanText(it.Meaning), L.FieldLength.Meaning) });
        }
        return clean;
    }

    public async Task<AiTaskResult> GenerateDeckAsync(GenerateDeckInput? input, CancellationToken ct)
    {
        var (topic, level, count) = CheckGenerateDeck(input);
        var p = Prompt("generateDeck");
        var user = p.User.Replace("{topic}", topic).Replace("{level}", level).Replace("{count}", count.ToString());
        var r = await structured.RunAsync(p.System, user, "deck", options.GenerateMaxTokens, ct);
        var value = new JsonObject
        {
            ["name"] = Clip((string?)r.Value["name"], L.FieldLength.DeckName) is { Length: > 0 } n ? n : Clip(topic, L.FieldLength.DeckName),
            ["description"] = Clip((string?)r.Value["description"], L.FieldLength.DeckDescription),
            ["level"] = level,
            ["items"] = CleanItems(r.Value["items"], count, null),
        };
        return new AiTaskResult(value, r.Usage);
    }

    public async Task<AiTaskResult> SuggestPhrasesAsync(SuggestPhrasesInput? input, CancellationToken ct)
    {
        var word = CheckWord(input);
        var p = Prompt("suggestPhrases");
        var r = await structured.RunAsync(p.System, p.User.Replace("{word}", word), "items", options.LookupMaxTokens * 2, ct);
        // Only multi-word expressions: single words are what the player already has.
        return new AiTaskResult(new JsonObject { ["items"] = CleanItems(r.Value["items"], MaxSuggestions, t => t != "word") }, r.Usage);
    }

    public async Task<AiTaskResult> ExtractItemsAsync(ExtractItemsInput? input, CancellationToken ct)
    {
        var (passage, level) = CheckExtract(input);
        var p = Prompt("extractItems");
        var user = p.User.Replace("{level}", level).Replace("{passage}", passage.Replace("\"\"\"", "\""));
        var r = await structured.RunAsync(p.System, user, "items", options.GenerateMaxTokens, ct);
        return new AiTaskResult(new JsonObject { ["items"] = CleanItems(r.Value["items"], MaxExtracted, null) }, r.Usage);
    }

    /// <summary>Wrong options for up to 10 items in one call, returned in input order.</summary>
    public async Task<AiTaskResult> GenerateDistractorsAsync(DistractorsInput? input, CancellationToken ct)
    {
        var clean = CheckDistractors(input);
        var p = Prompt("distractors");
        var r = await structured.RunAsync(p.System, p.User.Replace("{items}", clean.ToJsonString()), "distractors", options.LookupMaxTokens, ct);
        var results = r.Value["results"]!.AsArray();
        var output = new JsonArray();
        for (var i = 0; i < clean.Count; i++)
        {
            var src = clean[i]!;
            var text = (string)src["text"]!;
            // Match by text first (models sometimes reorder), else by position.
            var res = results.FirstOrDefault(x => string.Equals((string?)x?["text"], text, StringComparison.OrdinalIgnoreCase))
                ?? (i < results.Count ? results[i] : null);
            var isPhrasal = (string?)src["type"] == "phrasal_verb";
            output.Add(new JsonObject
            {
                ["text"] = text,
                ["wrongCollocations"] = CleanList(res?["wrongCollocations"], L.FieldLength.Text, text),
                ["wrongParticles"] = isPhrasal ? CleanList(res?["wrongParticles"], 20, ParticleOf(text)) : new JsonArray(),
                ["wrongSentences"] = CleanList(res?["wrongSentences"], L.FieldLength.Example, null),
            });
        }
        return new AiTaskResult(new JsonObject { ["results"] = output }, r.Usage);
    }

    /// <summary>The particle(s) after the verb: "look into" → "into".</summary>
    internal static string? ParticleOf(string phrasalVerb)
    {
        var parts = phrasalVerb.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length > 1 ? parts[1] : null;
    }

    private static string RequireLevel(string? level) =>
        level is not null && Levels.Contains(level) ? level : throw new InputException("Level phải là A1–C2.");

    private static string CleanText(string? s) => Regex.Replace(ControlChars().Replace(s ?? "", " "), @"\s+", " ").Trim();

    private static string Clip(string? s, int max)
    {
        var t = CleanText(s);
        return t.Length <= max ? t : t[..max].TrimEnd();
    }

    /// <summary>Distinct, non-empty, clipped strings, never equal to <paramref name="exclude"/>.</summary>
    private static JsonArray CleanList(JsonNode? node, int maxLength, string? exclude)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (exclude is not null) seen.Add(exclude);
        var list = new JsonArray();
        foreach (var x in node?.AsArray() ?? [])
        {
            var s = Clip((string?)x, maxLength);
            if (s.Length == 0 || !seen.Add(s)) continue;
            list.Add(s);
            if (list.Count == L.MaxDistractorsPerList) break;
        }
        return list;
    }

    /// <summary>Items as the frontend stores them: known types, clipped fields, examples ≤ limit, no duplicates.</summary>
    internal static JsonArray CleanItems(JsonNode? node, int max, Func<string, bool>? typeFilter)
    {
        var f = L.FieldLength;
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var list = new JsonArray();
        foreach (var x in node?.AsArray() ?? [])
        {
            if (x is null || list.Count == max) continue;
            var type = (string?)x["type"];
            if (type is null || !ItemTypes.Contains(type) || (typeFilter is not null && !typeFilter(type))) continue;
            var text = Clip((string?)x["text"], f.Text);
            var meaning = Clip((string?)x["meaning"], f.Meaning);
            if (text.Length == 0 || meaning.Length == 0 || !seen.Add($"{type}|{text}")) continue;

            var examples = new JsonArray();
            foreach (var e in x["examples"]?.AsArray() ?? [])
            {
                var en = Clip((string?)e?["en"], f.Example);
                if (en.Length == 0 || examples.Count == L.MaxExamplesPerItem) continue;
                examples.Add(new JsonObject { ["en"] = en, ["vi"] = Clip((string?)e?["vi"], f.Example) });
            }
            var item = new JsonObject { ["type"] = type, ["text"] = text, ["meaning"] = meaning, ["examples"] = examples, ["tags"] = new JsonArray() };
            AddIfPresent(item, "partOfSpeech", Clip((string?)x["partOfSpeech"], f.PartOfSpeech));
            AddIfPresent(item, "ipa", Clip((string?)x["ipa"], f.Ipa));
            AddIfPresent(item, "note", Clip((string?)x["note"], f.Note));
            list.Add(item);
        }
        return list;
    }

    private static void AddIfPresent(JsonObject o, string key, string value)
    {
        if (value.Length > 0) o[key] = value;
    }
}
