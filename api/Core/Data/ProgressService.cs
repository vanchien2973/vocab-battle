using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace VocabBattle.Api.Core.Data;

/// <summary>
/// FSRS progress, one document per deck in the user's partition: <c>cards</c> ("itemId|cardType" → card state)
/// and <c>days</c> ("yyyy-MM-dd" → counters). Clients send batches (end of session or every 10 cards) that are
/// merged here, the same way as mergeProgress in src/study/fsrs.ts.
/// </summary>
public sealed partial class ProgressService(DataStores stores, TimeProvider time)
{
    public const int MaxCardsPerBatch = 2000;
    public const int MaxCardsPerDeck = 2000;
    public const int KeepDays = 60;
    public const int MaxAttempts = 3;
    public const int MaxTypingSessions = 100;
    public const int MaxTypingPerBatch = 20;
    public static readonly string[] TypingContents = ["copy", "meaning", "listen", "cloze"];
    public static readonly string[] TypingModes = ["solo", "bot", "online"];
    public static readonly string[] CardTypes = ["en-vi", "vi-en", "cloze", "listen"];

    [GeneratedRegex(@"^[A-Za-z0-9:_-]{1,64}\|(en-vi|vi-en|cloze|listen)$")]
    private static partial Regex CardKey();

    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}$")]
    private static partial Regex DayKey();

    private static readonly string[] CardNumbers = ["stability", "difficulty", "scheduled_days", "learning_steps", "reps", "lapses", "state"];

    public async Task<JsonObject> GetAsync(string userId, string deckId, CancellationToken ct)
    {
        DeckService.RequireId(deckId);
        var stored = await stores.Progress.ReadAsync(userId, deckId, ct);
        return stored is null ? Empty(deckId) : ForClient(stored);
    }

    /// <summary>Merge a batch: newer card states win, day counters add up, days older than 60 are dropped.</summary>
    public async Task<JsonObject> MergeAsync(string userId, string deckId, JsonObject? batch, CancellationToken ct)
    {
        DeckService.RequireId(deckId);
        var (cards, days, typing) = ValidateBatch(batch);
        for (var attempt = 1; ; attempt++)
        {
            var stored = await stores.Progress.ReadAsync(userId, deckId, ct);
            var doc = stored?.Doc.DeepClone().AsObject() ?? new JsonObject { ["id"] = deckId, ["deckId"] = deckId, ["cards"] = new JsonObject(), ["days"] = new JsonObject() };
            doc["userId"] = userId;
            Merge(doc, cards, days, time.GetUtcNow(), typing);
            if (doc["cards"]!.AsObject().Count > MaxCardsPerDeck) throw new DataException(400, "Quá nhiều thẻ trong một bộ.");
            try
            {
                var saved = stored is null
                    ? await stores.Progress.CreateAsync(userId, doc, ct)
                    : await stores.Progress.ReplaceAsync(userId, doc, stored.ETag, ct);
                return ForClient(saved);
            }
            catch (Exception e) when (e is StorePreconditionException or StoreConflictException or StoreNotFoundException && attempt < MaxAttempts)
            {
                // Another session wrote meanwhile: re-read and merge again.
            }
        }
    }

    internal static void Merge(JsonObject doc, JsonObject cards, JsonObject days, DateTimeOffset now, JsonArray? typing = null)
    {
        if (typing is { Count: > 0 })
        {
            // Luyện Gõ history: append (no duplicate times), keep the newest 100, oldest first.
            var byAt = new SortedDictionary<string, JsonNode>(StringComparer.Ordinal);
            foreach (var s in (doc["typing"] as JsonArray ?? []).Concat(typing))
                if (s is not null) byAt[(string)s["at"]!] = s.DeepClone();
            doc["typing"] = new JsonArray(byAt.Values.TakeLast(MaxTypingSessions).ToArray());
        }
        var storedCards = doc["cards"] as JsonObject ?? [];
        foreach (var (key, card) in cards)
        {
            var current = storedCards[key];
            if (current is null || string.CompareOrdinal(LastReview(card), LastReview(current)) >= 0)
                storedCards[key] = card!.DeepClone();
        }
        doc["cards"] = storedCards;

        var storedDays = doc["days"] as JsonObject ?? [];
        foreach (var (key, day) in days) storedDays[key] = AddDays(storedDays[key] as JsonObject, day!.AsObject());
        var cutoff = now.UtcDateTime.Date.AddDays(-KeepDays).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        foreach (var key in storedDays.Select(p => p.Key).Where(k => string.CompareOrdinal(k, cutoff) < 0).ToList())
            storedDays.Remove(key);
        doc["days"] = storedDays;
        doc["updatedAt"] = now.ToString("O");
    }

    private static string LastReview(JsonNode? card) => (string?)card?["last_review"] ?? "";

    private static JsonObject AddDays(JsonObject? a, JsonObject b)
    {
        var result = new JsonObject
        {
            ["reviews"] = Int(a?["reviews"]) + Int(b["reviews"]),
            ["again"] = Int(a?["again"]) + Int(b["again"]),
            ["newCards"] = Int(a?["newCards"]) + Int(b["newCards"]),
        };
        var byType = (a?["byType"] as JsonObject)?.DeepClone().AsObject() ?? [];
        foreach (var (type, pair) in b["byType"] as JsonObject ?? [])
        {
            var cur = byType[type] as JsonArray;
            byType[type] = new JsonArray(Int(cur?[0]) + Int(pair![0]), Int(cur?[1]) + Int(pair[1]));
        }
        result["byType"] = byType;
        return result;
    }

    private static int Int(JsonNode? n) => TryNumber(n, out var x) && x is >= int.MinValue and <= int.MaxValue ? (int)x : 0;

    /// <summary>Check shape and sizes of a client batch; throws 400 with a message.</summary>
    internal static (JsonObject Cards, JsonObject Days, JsonArray Typing) ValidateBatch(JsonObject? batch)
    {
        var cards = batch?["cards"] as JsonObject ?? [];
        var days = batch?["days"] as JsonObject ?? [];
        var typing = batch?["typing"] as JsonArray ?? [];
        if (batch is null || cards.Count + days.Count + typing.Count == 0) throw new DataException(400, "Lô tiến độ trống.");
        if (typing.Count > MaxTypingPerBatch) throw Bad("Quá nhiều phiên Luyện Gõ trong một lô.");
        foreach (var t in typing)
        {
            if (t is not JsonObject s || !IsDate(s["at"]) || s.Count > 7) throw Bad("Phiên Luyện Gõ không hợp lệ.");
            if (!TryNumber(s["score"], out var score) || score is < 0 or > 1e7 ||
                !TryNumber(s["wpm"], out var w) || w is < 0 or > 1000 ||
                !TryNumber(s["accuracy"], out var acc) || acc is < 0 or > 1 ||
                !TryNumber(s["milestone"], out var m) || m is < 1 or > 20 ||
                (string?)s["content"] is not { } content || !TypingContents.Contains(content) ||
                (string?)s["mode"] is not { } mode || !TypingModes.Contains(mode))
                throw Bad("Phiên Luyện Gõ không hợp lệ.");
        }
        if (cards.Count > MaxCardsPerBatch) throw new DataException(400, "Lô tiến độ quá lớn.");
        if (days.Count > KeepDays) throw new DataException(400, "Quá nhiều ngày trong một lô.");

        foreach (var (key, card) in cards)
        {
            if (!CardKey().IsMatch(key) || card is not JsonObject c) throw Bad("Khoá thẻ không hợp lệ.");
            if (!IsDate(c["due"]) || (c["last_review"] is { } lr && !IsDate(lr))) throw Bad("Ngày của thẻ không hợp lệ.");
            foreach (var name in CardNumbers)
            {
                if (!TryNumber(c[name], out var x) || !double.IsFinite(x) || x < 0 || x > 1_000_000)
                    throw Bad("Thông số thẻ không hợp lệ.");
            }
            if (c.Count > CardNumbers.Length + 3) throw Bad("Thẻ có trường lạ.");
        }
        foreach (var (key, day) in days)
        {
            if (!DayKey().IsMatch(key) || day is not JsonObject d) throw Bad("Ngày thống kê không hợp lệ.");
            foreach (var name in new[] { "reviews", "again", "newCards" })
            {
                if (!TryNumber(d[name], out var x) || x != Math.Floor(x) || x is < 0 or > 10_000) throw Bad("Thống kê không hợp lệ.");
            }
            foreach (var (type, pair) in d["byType"] as JsonObject ?? [])
            {
                if (!DeckModel.ItemTypes.Contains(type) || pair is not JsonArray { Count: 2 } p || p.Any(x => Int(x) is < 0 or > 10_000))
                    throw Bad("Thống kê theo loại không hợp lệ.");
            }
        }
        return (cards, days, typing);
    }

    private static bool TryNumber(JsonNode? n, out double value)
    {
        value = 0;
        return n is JsonValue v && v.GetValueKind() == System.Text.Json.JsonValueKind.Number &&
            double.TryParse(v.ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture, out value);
    }

    private static bool IsDate(JsonNode? n) =>
        n is JsonValue v && v.TryGetValue<string>(out var s) && s.Length <= 40 &&
        DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out _);

    private static DataException Bad(string message) => new(400, message);

    private static JsonObject Empty(string deckId) =>
        new() { ["deckId"] = deckId, ["cards"] = new JsonObject(), ["days"] = new JsonObject(), ["updatedAt"] = DateTimeOffset.UnixEpoch.ToString("O") };

    private static JsonObject ForClient(StoredDoc stored)
    {
        var d = stored.Doc.DeepClone().AsObject();
        foreach (var p in DeckModel.SystemProperties) d.Remove(p);
        d.Remove("userId");
        d.Remove("id");
        d["_etag"] = stored.ETag;
        return d;
    }
}
