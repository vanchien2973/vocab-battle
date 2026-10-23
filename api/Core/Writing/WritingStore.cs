using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using VocabBattle.Api.Core.Data;

namespace VocabBattle.Api.Core.Writing;

/// <summary>
/// Graded essays in the "writings" container (partition /userId). Each attempt is one document; one
/// "index" document per user holds the history summaries, the running error totals (for a future weak-points
/// dashboard) and today's grading quota, so the history page and the quota check cost a single point read.
/// Every call is scoped to the caller's partition, so users can never read or delete someone else's essays.
/// </summary>
public sealed partial class WritingStore(DataStores stores, TimeProvider time)
{
    public const string IndexId = "index";
    public const int MaxAttempts = 3;

    [GeneratedRegex("^w-[a-f0-9]{32}$")]
    private static partial Regex IdPattern();

    private static VstepConfig C => VstepConfig.Current;
    private IDocumentStore Store => stores.Writings;

    private string Today => time.GetUtcNow().ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>How many gradings the user has left today (never negative).</summary>
    public async Task<int> RemainingTodayAsync(string userId, int perDay, CancellationToken ct)
    {
        var index = await Store.ReadAsync(userId, IndexId, ct);
        var quota = index?.Doc["quota"];
        var used = (string?)quota?["day"] == Today ? (int?)quota?["count"] ?? 0 : 0;
        return Math.Max(0, perDay - used);
    }

    /// <summary>Store a graded attempt: numbers the attempt, adds the summary and error counts, counts today's quota.</summary>
    public async Task<JsonObject> SaveAsync(string userId, CheckedGrade g, JsonObject result, CancellationToken ct)
    {
        var promptId = WritingText.PromptId(g.PromptText);
        var id = "w-" + Guid.NewGuid().ToString("N");
        var createdAt = time.GetUtcNow().ToString("O");
        var counts = ErrorCounts(result["errors"] as JsonArray);
        var attempt = 1;
        await UpdateIndexAsync(userId, index =>
        {
            var summaries = index["summaries"]!.AsArray();
            // Per-prompt counters outlive the capped summary list, so numbering stays right.
            var attempts = index["attempts"] as JsonObject ?? [];
            attempt = ((int?)attempts[promptId] ?? summaries.Count(s => (string?)s?["promptId"] == promptId)) + 1;
            attempts[promptId] = attempt;
            index["attempts"] = attempts;
            summaries.Add(Summary(id, g, promptId, attempt, result, counts, createdAt));
            while (summaries.Count > C.HistoryLimit) summaries.RemoveAt(0);
            index["stats"] = AddCounts(index["stats"] as JsonObject, counts, 1);
            var quota = index["quota"] as JsonObject;
            var used = (string?)quota?["day"] == Today ? (int?)quota?["count"] ?? 0 : 0;
            index["quota"] = new JsonObject { ["day"] = Today, ["count"] = used + 1 };
        }, ct);

        var doc = new JsonObject
        {
            ["id"] = id,
            ["userId"] = userId,
            ["kind"] = "writing",
            ["task"] = g.Task,
            ["level"] = g.Level,
            ["topic"] = g.Prompt["topic"]!.DeepClone(),
            ["prompt"] = g.Prompt.DeepClone(),
            ["promptId"] = promptId,
            ["attempt"] = attempt,
            ["text"] = g.Essay,
            ["wordCount"] = g.WordCount,
            ["durationSec"] = g.DurationSec,
            ["result"] = result.DeepClone(),
            ["createdAt"] = createdAt,
        };
        if (g.ExamId is not null) doc["examId"] = g.ExamId;
        await Store.CreateAsync(userId, doc, ct);
        return new JsonObject { ["id"] = id, ["promptId"] = promptId, ["attempt"] = attempt };
    }

    /// <summary>History rows (newest last as stored) and error totals.</summary>
    public async Task<JsonObject> HistoryAsync(string userId, CancellationToken ct)
    {
        var index = await Store.ReadAsync(userId, IndexId, ct);
        return new JsonObject
        {
            ["summaries"] = index?.Doc["summaries"]?.DeepClone() ?? new JsonArray(),
            ["stats"] = index?.Doc["stats"]?.DeepClone() ?? EmptyStats(),
        };
    }

    public async Task<JsonObject> GetAsync(string userId, string id, CancellationToken ct)
    {
        RequireId(id);
        var stored = await Store.ReadAsync(userId, id, ct) ?? throw NotFound();
        var d = stored.Doc.DeepClone().AsObject();
        foreach (var p in DeckModel.SystemProperties) d.Remove(p);
        d.Remove("userId");
        d.Remove("kind");
        return d;
    }

    public async Task DeleteAsync(string userId, string id, CancellationToken ct)
    {
        RequireId(id);
        var stored = await Store.ReadAsync(userId, id, ct) ?? throw NotFound();
        await Store.DeleteAsync(userId, id, ct);
        var counts = ErrorCounts(stored.Doc["result"]?["errors"] as JsonArray);
        await UpdateIndexAsync(userId, index =>
        {
            var summaries = index["summaries"]!.AsArray();
            var row = summaries.FirstOrDefault(s => (string?)s?["id"] == id);
            if (row is not null) summaries.Remove(row);
            index["stats"] = AddCounts(index["stats"] as JsonObject, counts, -1);
        }, ct);
    }

    /// <summary>Read-modify-write the index with its etag; retried when another request wrote meanwhile.</summary>
    private async Task UpdateIndexAsync(string userId, Action<JsonObject> change, CancellationToken ct)
    {
        for (var attempt = 1; ; attempt++)
        {
            var stored = await Store.ReadAsync(userId, IndexId, ct);
            var index = stored?.Doc.DeepClone().AsObject() ?? new JsonObject { ["id"] = IndexId, ["kind"] = "index" };
            index["userId"] = userId;
            if (index["summaries"] is not JsonArray) index["summaries"] = new JsonArray();
            change(index);
            try
            {
                if (stored is null) await Store.CreateAsync(userId, index, ct);
                else await Store.ReplaceAsync(userId, index, stored.ETag, ct);
                return;
            }
            catch (Exception e) when (e is StorePreconditionException or StoreConflictException or StoreNotFoundException && attempt < MaxAttempts)
            {
                // Another request wrote the index: read it again.
            }
        }
    }

    internal static JsonObject Summary(string id, CheckedGrade g, string promptId, int attempt, JsonObject result, JsonObject counts, string createdAt)
    {
        var s = new JsonObject
        {
            ["id"] = id,
            ["task"] = g.Task,
            ["level"] = g.Level,
            ["topic"] = g.Prompt["topic"]!.DeepClone(),
            ["title"] = g.Prompt["title"]!.DeepClone(),
            ["promptId"] = promptId,
            ["attempt"] = attempt,
            ["wordCount"] = g.WordCount,
            ["durationSec"] = g.DurationSec,
            ["createdAt"] = createdAt,
            ["taskScore"] = result["taskScore"]!.DeepClone(),
            ["band"] = result["band"]!.DeepClone(),
            ["criteria"] = new JsonObject(WritingScoring.Criteria.Select(c =>
                KeyValuePair.Create(c, result["criteria"]?[c]?["score"]?.DeepClone()))),
            ["errorCounts"] = counts.DeepClone(),
        };
        if (g.ExamId is not null) s["examId"] = g.ExamId;
        return s;
    }

    /// <summary>Mistakes per category and per rule (same as errorCountsOf in src/vstep/stats.ts).</summary>
    internal static JsonObject ErrorCounts(JsonArray? errors)
    {
        var categories = new SortedDictionary<string, int>(StringComparer.Ordinal);
        var rules = new SortedDictionary<string, int>(StringComparer.Ordinal);
        foreach (var e in errors ?? [])
        {
            if ((string?)e?["category"] is { } c) categories[c] = categories.GetValueOrDefault(c) + 1;
            if ((string?)e?["rule"] is { } r) rules[r] = rules.GetValueOrDefault(r) + 1;
        }
        return new JsonObject { ["categories"] = Bag(categories), ["rules"] = Bag(rules) };
    }

    internal static JsonObject AddCounts(JsonObject? stats, JsonObject counts, int sign)
    {
        var s = stats?.DeepClone().AsObject() ?? EmptyStats();
        s["writings"] = Math.Max(0, ((int?)s["writings"] ?? 0) + sign);
        foreach (var bag in new[] { "categories", "rules" })
        {
            var target = s[bag] as JsonObject ?? [];
            foreach (var (k, v) in counts[bag] as JsonObject ?? [])
            {
                var n = ((int?)target[k] ?? 0) + sign * ((int?)v ?? 0);
                if (n > 0) target[k] = n;
                else target.Remove(k);
            }
            s[bag] = target;
        }
        return s;
    }

    private static JsonObject EmptyStats() => new() { ["writings"] = 0, ["categories"] = new JsonObject(), ["rules"] = new JsonObject() };

    private static JsonObject Bag(SortedDictionary<string, int> d) => new(d.Select(kv => KeyValuePair.Create(kv.Key, (JsonNode?)kv.Value)));

    private static void RequireId(string id)
    {
        if (!IdPattern().IsMatch(id)) throw new DataException(400, "Mã bài viết không hợp lệ.");
    }

    private static DataException NotFound() => new(404, "Không tìm thấy bài viết.");
}
