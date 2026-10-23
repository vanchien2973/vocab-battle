using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace VocabBattle.Api.Core.Writing;

public sealed record WritingPromptInput(int? Task, string? Level, string? Topic, string? EssayType, List<string>? Avoid);

public sealed record PromptDto(
    string? Title, string? Text, string? Topic, string? EssayType, List<string>? Requirements, string? Register, string? Source);

public sealed record GradeWritingInput(int? Task, string? Level, PromptDto? Prompt, string? Essay, int? DurationSec, string? ExamId);

/// <summary>A grading request after validation.</summary>
public sealed record CheckedGrade(
    int Task, string Level, JsonObject Prompt, string PromptText, string Essay, int WordCount, int DurationSec, string? ExamId);

/// <summary>
/// VSTEP writing: prompt generation and grading. Prompts, rubric and schemas are fixed server-side (AiShared);
/// the model's output is schema-validated (StructuredService) and the scores are recomputed here from the
/// criteria, never taken from the model's own total.
/// </summary>
public sealed partial class WritingService(StructuredService structured, AiOptions options)
{
    public const int PromptMaxTokens = 1500;
    public const int MaxDurationSec = 4 * 3600;
    private static readonly string[] Registers = ["formal", "informal", "semi-formal"];
    private static readonly string[] ItemTypes = ["word", "collocation", "phrasal_verb", "idiom", "pattern"];
    private static readonly string[] Categories = ["grammar", "vocabulary", "spelling", "punctuation", "coherence", "task", "register"];

    [GeneratedRegex(@"[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]")]
    private static partial Regex ControlChars();

    [GeneratedRegex(@"^[A-Za-z0-9_-]{1,40}$")]
    private static partial Regex ExamIdPattern();

    private static VstepConfig C => VstepConfig.Current;

    // ---------- input checks (mirror src/vstep/aiTasks.ts) ----------

    /// <summary>Validate before any rate limit or provider call; throws <see cref="InputException"/>.</summary>
    public static void Precheck(object? body)
    {
        switch (body)
        {
            case WritingPromptInput p: CheckPrompt(p); break;
            case GradeWritingInput g: CheckGrade(g); break;
        }
    }

    internal static (int Task, string Level, string Topic, string EssayType, List<string> Avoid) CheckPrompt(WritingPromptInput? input)
    {
        var task = RequireTask(input?.Task);
        var level = RequireLevel(input?.Level);
        var topic = input?.Topic == "random" ? C.Topics[Random.Shared.Next(C.Topics.Count)].Id : input?.Topic;
        if (topic is null || C.Topics.All(t => t.Id != topic)) throw new InputException("Chủ đề không hợp lệ.");
        var essayType = task == 1 ? "" : string.IsNullOrEmpty(input?.EssayType) ? C.EssayTypes[Random.Shared.Next(C.EssayTypes.Count)].Id : input.EssayType;
        if (essayType.Length > 0 && C.EssayTypes.All(t => t.Id != essayType)) throw new InputException("Dạng bài không hợp lệ.");
        var avoid = (input?.Avoid ?? []).Select(a => OneLine(a, C.MaxTitleLength)).Where(a => a.Length > 0).Take(C.MaxAvoid).ToList();
        return (task, level, topic, essayType, avoid);
    }

    public static CheckedGrade CheckGrade(GradeWritingInput? input)
    {
        var task = RequireTask(input?.Task);
        var level = RequireLevel(input?.Level);
        var promptText = Clean(input?.Prompt?.Text);
        if (promptText.Length == 0 || promptText.Length > C.MaxPromptLength)
            throw new InputException($"Đề bài cần từ 1 đến {C.MaxPromptLength} ký tự.");
        var essay = Clean(input?.Essay);
        var words = WritingText.CountWords(essay);
        if (words == 0) throw new InputException("Bài viết đang trống.");
        if (words > C.MaxWords) throw new InputException($"Bài viết tối đa {C.MaxWords} từ (hiện có {words}).");
        var examId = input?.ExamId is { Length: > 0 } e ? (ExamIdPattern().IsMatch(e) ? e : throw new InputException("examId không hợp lệ.")) : null;
        return new CheckedGrade(task, level, CleanPromptDto(input!.Prompt!, task, promptText), promptText, essay, words,
            Math.Clamp(input.DurationSec ?? 0, 0, MaxDurationSec), examId);
    }

    /// <summary>The prompt as stored with an attempt: known topic/type/register only, clipped text.</summary>
    private static JsonObject CleanPromptDto(PromptDto p, int task, string text)
    {
        var topic = p.Topic is { } t && C.Topics.Any(x => x.Id == t) ? t : "custom";
        return new JsonObject
        {
            ["task"] = task,
            ["title"] = OneLine(p.Title, C.MaxTitleLength) is { Length: > 0 } title ? title : OneLine(text, 80),
            ["text"] = text,
            ["topic"] = topic,
            ["essayType"] = task == 2 && p.EssayType is { } et && C.EssayTypes.Any(x => x.Id == et) ? et : "",
            ["requirements"] = new JsonArray((task == 1 ? p.Requirements ?? [] : [])
                .Select(r => OneLine(r, 300)).Where(r => r.Length > 0).Take(5).Select(r => (JsonNode)r).ToArray()),
            ["register"] = task == 1 && p.Register is { } reg && Registers.Contains(reg) ? reg : "",
            ["source"] = p.Source == "ai" ? "ai" : "custom",
        };
    }

    // ---------- AI calls ----------

    public async Task<AiTaskResult> GeneratePromptAsync(WritingPromptInput? input, CancellationToken ct)
    {
        var (task, level, topic, essayType, avoid) = CheckPrompt(input);
        var cfg = C.Task(task);
        var p = AiShared.Prompts.Tasks["writingPrompt"];
        var user = WritingText.Fill(p.User, new Dictionary<string, string>
        {
            ["task"] = task.ToString(),
            ["kind"] = cfg.Kind,
            ["minWords"] = cfg.MinWords.ToString(),
            ["topic"] = C.Topics.First(t => t.Id == topic).En ?? topic,
            ["essayType"] = essayType.Length > 0 ? essayType : "none (letter)",
            ["level"] = level,
            ["avoid"] = avoid.Count > 0 ? string.Join("\n", avoid.Select(a => "- " + a)) : "(none)",
        });
        var system = WritingText.Fill(p.System, new Dictionary<string, string> { ["minWords"] = cfg.MinWords.ToString() });
        var r = await structured.RunAsync(system, user, "writing-prompt", PromptMaxTokens, ct);
        var text = Clip((string?)r.Value["text"], C.MaxPromptLength);
        if (text.Length == 0) throw new StructuredFormatException("empty prompt text", r.Usage);
        var genType = (string?)r.Value["essayType"];
        var value = new JsonObject
        {
            ["task"] = task,
            ["title"] = OneLine((string?)r.Value["title"], C.MaxTitleLength) is { Length: > 0 } title ? title : OneLine(text, 60),
            ["text"] = text,
            ["topic"] = topic,
            ["essayType"] = task == 2 ? (genType is not null && C.EssayTypes.Any(t => t.Id == genType) ? genType : essayType) : "",
            ["requirements"] = new JsonArray((task == 1 ? r.Value["requirements"]?.AsArray() ?? [] : [])
                .Select(x => OneLine((string?)x, 300)).Where(x => x.Length > 0).Take(5).Select(x => (JsonNode)x).ToArray()),
            ["register"] = task == 1 && (string?)r.Value["register"] is { } reg && Registers.Contains(reg) ? reg : "",
            ["source"] = "ai",
        };
        return new AiTaskResult(value, r.Usage);
    }

    /// <summary>
    /// Grade with two calls in parallel (scores + errors, and rewrite + phrases) so the request stays well
    /// under the SWA timeout. A failed rewrite still returns the scores.
    /// </summary>
    public async Task<AiTaskResult> GradeAsync(CheckedGrade g, CancellationToken ct)
    {
        var cfg = C.Task(g.Task);
        var values = new Dictionary<string, string>
        {
            ["task"] = g.Task.ToString(),
            ["kind"] = cfg.Kind,
            ["minWords"] = cfg.MinWords.ToString(),
            ["level"] = g.Level,
            ["wordCount"] = g.WordCount.ToString(),
            ["prompt"] = g.PromptText.Replace("\"\"\"", "\""),
            ["essay"] = g.Essay.Replace("\"\"\"", "\""),
        };
        var gp = AiShared.Prompts.Tasks["writingGrade"];
        var rp = AiShared.Prompts.Tasks["writingRewrite"];
        StructuredRequest Overrides(StructuredRequest r) =>
            r with { Model = options.EffectiveGradingModel, Effort = options.GradingEffort, Temperature = options.GradingTemperature };

        var gradeTask = Run(gp.System, WritingText.Fill(gp.User, values), "writing-grade", Overrides, ct);
        var rewriteTask = Run(rp.System, WritingText.Fill(rp.User, values), "writing-rewrite", Overrides, ct);
        await Task.WhenAll(gradeTask, rewriteTask);
        var (grade, gradeError, gradeUsage) = gradeTask.Result;
        var (rewrite, rewriteError, rewriteUsage) = rewriteTask.Result;
        var usage = gradeUsage + rewriteUsage;
        if (gradeError is StructuredFormatException sf) throw new StructuredFormatException(sf.Detail, usage);
        if (gradeError is not null) throw gradeError;
        var message = rewriteError is null ? null : rewriteError is AiProviderException or StructuredFormatException ? rewriteError.Message : "Chưa tạo được bản viết lại.";
        return new AiTaskResult(BuildResult(grade!, rewrite, g.Task, g.Level, g.WordCount, options.EffectiveGradingModel, DateTimeOffset.UtcNow, message), usage);
    }

    private async Task<(JsonNode? Value, Exception? Error, AiUsage Usage)> Run(
        string system, string user, string schema, Func<StructuredRequest, StructuredRequest> overrides, CancellationToken ct)
    {
        try
        {
            var r = await structured.RunAsync(system, user, schema, options.GradingMaxTokens, ct, overrides);
            return (r.Value, null, r.Usage);
        }
        catch (StructuredFormatException e)
        {
            return (null, e, e.Usage);
        }
        catch (AiProviderException e)
        {
            return (null, e, AiUsage.Zero);
        }
    }

    // ---------- result (mirror buildGradeResult in src/vstep/scoring.ts) ----------

    internal static JsonObject BuildResult(
        JsonNode grade, JsonNode? rewrite, int task, string level, int wordCount, string model, DateTimeOffset now, string? rewriteError = null)
    {
        var minWords = C.Task(task).MinWords;
        var criteria = new JsonObject();
        var scores = new Dictionary<string, double>();
        foreach (var c in WritingScoring.Criteria)
        {
            var r = grade["criteria"]?[c];
            var score = WritingScoring.Clamp(Number(r?["score"]));
            if (c == "taskFulfilment" && wordCount < minWords) score = Math.Min(score, WritingScoring.ShortEssayCap(wordCount, minWords));
            scores[c] = score;
            criteria[c] = new JsonObject
            {
                ["score"] = score,
                ["comment"] = Clip((string?)r?["comment"], 1000),
                ["evidence"] = List(r?["evidence"], C.MaxEvidence, 300),
            };
        }
        var taskScore = WritingScoring.TaskScore(WritingScoring.Criteria.Select(c => scores[c]));
        var rewriteText = rewrite is null ? "" : Clip((string?)rewrite["rewrite"], 8000);
        var result = new JsonObject
        {
            ["task"] = task,
            ["level"] = level,
            ["wordCount"] = wordCount,
            ["minWords"] = minWords,
            ["criteria"] = criteria,
            ["taskScore"] = taskScore,
            ["band"] = WritingScoring.Band(taskScore),
            ["shortPenalty"] = wordCount < minWords,
            ["errors"] = CleanErrors(grade["errors"]),
            ["strengths"] = List(grade["strengths"], C.MaxListItems, 400),
            ["improvements"] = List(grade["improvements"], C.MaxListItems, 400),
            ["rewrite"] = rewriteText.Length > 0 ? rewriteText : null,
            ["usefulPhrases"] = rewrite is null ? new JsonArray() : CleanPhrases(rewrite["usefulPhrases"]),
            ["model"] = model,
            ["gradedAt"] = now.ToString("O"),
        };
        if (rewriteText.Length == 0) result["rewriteError"] = rewriteError ?? "Chưa tạo được bản viết lại.";
        return result;
    }

    private static JsonArray CleanErrors(JsonNode? node)
    {
        var rules = C.ErrorRules.Select(r => r.Id).ToHashSet();
        var list = new JsonArray();
        foreach (var e in node?.AsArray() ?? [])
        {
            if (e is null || list.Count == C.MaxErrors) continue;
            var quote = Clip((string?)e["quote"], 300);
            var category = (string?)e["category"];
            if (quote.Length == 0 || category is null || !Categories.Contains(category)) continue;
            var occurrence = Number(e["occurrence"]);
            var rule = (string?)e["rule"];
            list.Add(new JsonObject
            {
                ["quote"] = quote,
                ["occurrence"] = occurrence >= 1 ? (int)Math.Min(Math.Floor(occurrence), 1000) : 1,
                ["category"] = category,
                ["rule"] = rule is not null && rules.Contains(rule) ? rule : "other",
                ["severity"] = (string?)e["severity"] == "major" ? "major" : "minor",
                ["correction"] = Clip((string?)e["correction"], 300),
                ["explanationVi"] = Clip((string?)e["explanationVi"], 600),
            });
        }
        return list;
    }

    private static JsonArray CleanPhrases(JsonNode? node)
    {
        var f = AiShared.Limits.FieldLength;
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var list = new JsonArray();
        foreach (var p in node?.AsArray() ?? [])
        {
            if (p is null || list.Count == C.MaxPhrases) continue;
            var type = (string?)p["type"];
            var text = Clip((string?)p["text"], f.Text);
            var meaning = Clip((string?)p["meaningVi"], f.Meaning);
            if (type is null || !ItemTypes.Contains(type) || text.Length == 0 || meaning.Length == 0 || !seen.Add(text)) continue;
            list.Add(new JsonObject { ["text"] = text, ["type"] = type, ["meaningVi"] = meaning, ["example"] = Clip((string?)p["example"], f.Example) });
        }
        return list;
    }

    // ---------- helpers ----------

    private static int RequireTask(int? task) => task is 1 or 2 ? task.Value : throw new InputException("Task phải là 1 hoặc 2.");

    private static string RequireLevel(string? level) =>
        level is not null && C.TargetLevels.Contains(level) ? level : throw new InputException("Bậc mục tiêu phải là B1, B2 hoặc C1.");

    private static double Number(JsonNode? n) => n is JsonValue v && v.TryGetValue<double>(out var d) ? d : 0;

    private static string Clean(string? s) => ControlChars().Replace(s ?? "", "").Trim();

    private static string Clip(string? s, int max)
    {
        var t = Clean(s);
        return t.Length <= max ? t : t[..max].TrimEnd();
    }

    private static string OneLine(string? s, int max) => WritingText.NormalizeSpace(Clip(s, max));

    private static JsonArray List(JsonNode? node, int max, int length) =>
        new((node as JsonArray ?? []).Select(x => Clip((string?)x, length)).Where(x => x.Length > 0).Take(max).Select(x => (JsonNode)x).ToArray());
}
