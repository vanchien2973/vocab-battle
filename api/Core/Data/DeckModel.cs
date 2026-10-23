using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using FluentValidation;

namespace VocabBattle.Api.Core.Data;

public sealed class ExampleDto
{
    public string En { get; set; } = "";
    public string Vi { get; set; } = "";
}

public sealed class DistractorsDto
{
    public List<string> WrongCollocations { get; set; } = [];
    public List<string> WrongParticles { get; set; } = [];
    public List<string> WrongSentences { get; set; } = [];
}

/// <summary>One word or phrase in a deck (same shape as src/decks/types.ts Item).</summary>
public sealed class ItemDto
{
    public string Id { get; set; } = "";
    public string Type { get; set; } = "";
    public string Text { get; set; } = "";
    public string Meaning { get; set; } = "";
    public List<ExampleDto> Examples { get; set; } = [];
    public List<string> Tags { get; set; } = [];
    public string? Ipa { get; set; }
    public string? PartOfSpeech { get; set; }
    public string? Note { get; set; }
    public string? RelatedTo { get; set; }
    public DistractorsDto? Distractors { get; set; }
}

/// <summary>The fields a client may set on a deck. Server fields (userId, timestamps, schemaVersion) are assigned by the API.</summary>
public sealed class DeckInput
{
    public string? Id { get; set; }
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string Level { get; set; } = "mixed";
    public List<ItemDto> Items { get; set; } = [];
}

public static partial class DeckModel
{
    public const int SchemaVersion = 2;
    public static readonly string[] ItemTypes = AiTasksService.ItemTypes;
    public static readonly string[] Levels = ["mixed", "A1", "A2", "B1", "B2", "C1", "C2"];
    public static readonly string[] SystemProperties = ["_rid", "_self", "_attachments", "_ts", "_etag", "_lsn"];

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    [GeneratedRegex("^[A-Za-z0-9:_-]{1,64}$")]
    public static partial Regex IdPattern();

    public static string NewId() => Guid.NewGuid().ToString("N")[..16];

    /// <summary>
    /// Upgrade a stored or posted deck to schema v2: v1 <c>words[]</c> ({word, meaning, example, ipa, note})
    /// become <c>items[]</c> of type "word" with <c>example</c> as <c>examples[0]</c>. Returns a new object.
    /// </summary>
    public static JsonObject Migrate(JsonObject doc)
    {
        var d = doc.DeepClone().AsObject();
        var version = d["schemaVersion"] is JsonValue v && v.TryGetValue<int>(out var n) ? n : 1;
        if (version >= SchemaVersion && d["items"] is JsonArray) return d;

        var items = new JsonArray();
        foreach (var w in (d["words"] as JsonArray) ?? [])
        {
            if (w is not JsonObject word) continue;
            var example = Str(word["example"]).Trim();
            var item = new JsonObject
            {
                ["id"] = Str(word["id"]) is { Length: > 0 } id && IdPattern().IsMatch(id) ? id : NewId(),
                ["type"] = "word",
                ["text"] = Str(word["word"]),
                ["meaning"] = Str(word["meaning"]),
                ["examples"] = example.Length > 0 ? new JsonArray(new JsonObject { ["en"] = example, ["vi"] = "" }) : new JsonArray(),
                ["tags"] = new JsonArray(),
            };
            if (Str(word["ipa"]) is { Length: > 0 } ipa) item["ipa"] = ipa;
            if (Str(word["note"]) is { Length: > 0 } note) item["note"] = note;
            items.Add(item);
        }
        d.Remove("words");
        d["items"] = d["items"] is JsonArray existing && items.Count == 0 ? existing.DeepClone() : items;
        d["schemaVersion"] = SchemaVersion;
        return d;
    }

    /// <summary>Parse a request body (after migration) into the typed input; null when the JSON shape is wrong.</summary>
    public static DeckInput? ToInput(JsonObject body)
    {
        try
        {
            return Migrate(body).Deserialize<DeckInput>(Json);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>A stored document as the client sees it: no Cosmos system fields or userId, plus the etag.</summary>
    public static JsonObject ForClient(StoredDoc stored)
    {
        var d = Migrate(stored.Doc);
        foreach (var p in SystemProperties) d.Remove(p);
        d.Remove("userId");
        d["_etag"] = stored.ETag;
        return d;
    }

    private static string Str(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : "";

    public static int WordCount(string s) => s.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length;
}

public sealed class ItemValidator : AbstractValidator<ItemDto>
{
    public ItemValidator()
    {
        var f = AiShared.Limits.FieldLength;
        var max = AiShared.Limits.MaxDistractorsPerList;
        RuleFor(i => i.Id).Must(id => DeckModel.IdPattern().IsMatch(id ?? "")).WithMessage("Id mục không hợp lệ.");
        RuleFor(i => i.Type).Must(t => DeckModel.ItemTypes.Contains(t)).WithMessage("Loại mục không hợp lệ.");
        RuleFor(i => i.Text).NotEmpty().WithMessage("Thiếu từ/cụm từ.").MaximumLength(f.Text);
        RuleFor(i => i.Meaning).NotEmpty().WithMessage("Thiếu nghĩa.").MaximumLength(f.Meaning);
        RuleFor(i => i.Examples).Must(e => e.Count <= AiShared.Limits.MaxExamplesPerItem)
            .WithMessage($"Tối đa {AiShared.Limits.MaxExamplesPerItem} ví dụ mỗi mục.");
        RuleForEach(i => i.Examples).ChildRules(e =>
        {
            e.RuleFor(x => x.En).NotEmpty().WithMessage("Câu ví dụ trống.").MaximumLength(f.Example);
            e.RuleFor(x => x.Vi).MaximumLength(f.Example);
        });
        RuleFor(i => i.Tags).Must(t => t.Count <= AiShared.Limits.MaxTagsPerItem).WithMessage("Quá nhiều tag.");
        RuleForEach(i => i.Tags).NotEmpty().MaximumLength(f.Tag);
        RuleFor(i => i.Ipa).MaximumLength(f.Ipa);
        RuleFor(i => i.PartOfSpeech).MaximumLength(f.PartOfSpeech);
        RuleFor(i => i.Note).MaximumLength(f.Note);
        RuleFor(i => i.RelatedTo).Must(r => r is null || DeckModel.IdPattern().IsMatch(r)).WithMessage("relatedTo không hợp lệ.");

        // Rules per item type.
        RuleFor(i => i.Text)
            .Must(t => DeckModel.WordCount(t) >= 2)
            .When(i => i.Type is "collocation" or "phrasal_verb" && !string.IsNullOrWhiteSpace(i.Text))
            .WithMessage("Collocation và phrasal verb cần ít nhất 2 từ.");
        RuleFor(i => i.Distractors!.WrongParticles)
            .Empty()
            .When(i => i.Distractors is not null && i.Type != "phrasal_verb")
            .WithMessage("Tiểu từ sai chỉ dùng cho phrasal verb.");
        RuleFor(i => i.Distractors).ChildRules(d =>
        {
            d.RuleFor(x => x!.WrongCollocations).Must(l => l.Count <= max && l.All(s => s.Length is > 0 and <= 80)).WithMessage("Đáp án nhiễu không hợp lệ.");
            d.RuleFor(x => x!.WrongParticles).Must(l => l.Count <= max && l.All(s => s.Length is > 0 and <= 20)).WithMessage("Tiểu từ sai không hợp lệ.");
            d.RuleFor(x => x!.WrongSentences).Must(l => l.Count <= max && l.All(s => s.Length is > 0 and <= 300)).WithMessage("Câu sai không hợp lệ.");
        }).When(i => i.Distractors is not null);
    }
}

public sealed class DeckValidator : AbstractValidator<DeckInput>
{
    public DeckValidator()
    {
        var l = AiShared.Limits;
        RuleFor(d => d.Name).Must(n => !string.IsNullOrWhiteSpace(n)).WithMessage("Bộ từ cần có tên.")
            .MaximumLength(l.FieldLength.DeckName).WithMessage($"Tên bộ tối đa {l.FieldLength.DeckName} ký tự.");
        RuleFor(d => d.Description).MaximumLength(l.FieldLength.DeckDescription)
            .WithMessage($"Mô tả tối đa {l.FieldLength.DeckDescription} ký tự.");
        RuleFor(d => d.Level).Must(v => DeckModel.Levels.Contains(v)).WithMessage("Level không hợp lệ.");
        RuleFor(d => d.Items).Must(i => i.Count <= l.MaxItemsPerDeck).WithMessage($"Mỗi bộ tối đa {l.MaxItemsPerDeck} mục.");
        RuleFor(d => d.Items).Must(i => i.Select(x => x.Id).Distinct().Count() == i.Count).WithMessage("Id mục bị trùng.");
        RuleForEach(d => d.Items).SetValidator(new ItemValidator());
    }
}
