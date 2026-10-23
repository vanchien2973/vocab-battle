using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Time.Testing;
using VocabBattle.Api.Core;
using VocabBattle.Api.Core.Data;

namespace VocabBattle.Api.Tests;

/// <summary>In-memory container keyed by (partition key, id), with Cosmos-like etags and errors.</summary>
public sealed class InMemoryStore : IDocumentStore
{
    private readonly Dictionary<(string, string), StoredDoc> _docs = [];
    private int _version;

    public int Count => _docs.Count;

    public Task<StoredDoc?> ReadAsync(string pk, string id, CancellationToken ct) =>
        Task.FromResult(_docs.TryGetValue((pk, id), out var d) ? Copy(d) : null);

    public Task<StoredDoc> CreateAsync(string pk, JsonObject doc, CancellationToken ct)
    {
        var key = (pk, (string)doc["id"]!);
        if (_docs.ContainsKey(key)) throw new StoreConflictException();
        return Task.FromResult(Copy(_docs[key] = new StoredDoc(doc.DeepClone().AsObject(), NextEtag())));
    }

    public Task<StoredDoc> ReplaceAsync(string pk, JsonObject doc, string? ifMatch, CancellationToken ct)
    {
        var key = (pk, (string)doc["id"]!);
        if (!_docs.TryGetValue(key, out var current)) throw new StoreNotFoundException();
        if (ifMatch is not null && current.ETag != ifMatch) throw new StorePreconditionException();
        return Task.FromResult(Copy(_docs[key] = new StoredDoc(doc.DeepClone().AsObject(), NextEtag())));
    }

    public Task<bool> DeleteAsync(string pk, string id, CancellationToken ct) => Task.FromResult(_docs.Remove((pk, id)));

    /// <summary>Understands the two queries DeckService uses.</summary>
    public Task<IReadOnlyList<JsonNode>> QueryAsync(string pk, string sql, IReadOnlyDictionary<string, object> parameters, CancellationToken ct)
    {
        var inPartition = _docs.Where(d => d.Key.Item1 == pk).Select(d => d.Value.Doc).ToList();
        IReadOnlyList<JsonNode> result = sql.Contains("COUNT(1)")
            ? [JsonValue.Create(inPartition.Count)]
            : inPartition.Select(d => (JsonNode)new JsonObject
            {
                ["id"] = d["id"]?.DeepClone(),
                ["name"] = d["name"]?.DeepClone(),
                ["updatedAt"] = d["updatedAt"]?.DeepClone(),
                ["itemCount"] = (d["items"] as JsonArray)?.Count,
                ["wordCount"] = (d["words"] as JsonArray)?.Count,
            }).ToList();
        return Task.FromResult(result);
    }

    /// <summary>Put a raw document (e.g. an old v1 deck) straight into storage.</summary>
    public void Seed(string pk, JsonObject doc) => _docs[(pk, (string)doc["id"]!)] = new StoredDoc(doc, NextEtag());

    private string NextEtag() => $"\"etag-{++_version}\"";
    private static StoredDoc Copy(StoredDoc d) => new(d.Doc.DeepClone().AsObject(), d.ETag);
}

public class DataTests
{
    private const string Alice = "alice-id";
    private const string Bob = "bob-id";
    private readonly InMemoryStore _decks = new();
    private readonly InMemoryStore _progress = new();
    private readonly InMemoryStore _shares = new();
    private readonly FakeTimeProvider _time = new(new DateTimeOffset(2026, 10, 23, 8, 0, 0, TimeSpan.Zero));
    private readonly CancellationToken _ct = CancellationToken.None;

    private DataStores Stores => new(_decks, _progress, _shares);
    private DeckService Decks => new(Stores, _time);
    private ProgressService Progress => new(Stores, _time);
    private ShareService Shares => new(Stores, _time);

    private static JsonObject Item(string id, string type, string text, string meaning = "nghĩa") => new()
    {
        ["id"] = id, ["type"] = type, ["text"] = text, ["meaning"] = meaning,
        ["examples"] = new JsonArray(new JsonObject { ["en"] = $"Use {text} here.", ["vi"] = "" }), ["tags"] = new JsonArray(),
    };

    private static JsonObject DeckBody(string name = "Travel", params JsonObject[] items) => new()
    {
        ["name"] = name, ["description"] = "", ["level"] = "B1",
        ["items"] = new JsonArray(items.Length > 0 ? items : [Item("i1", "word", "trip")]),
    };

    private static async Task<DataException> Fails(Func<Task> act) => await Assert.ThrowsAsync<DataException>(act);

    // ---------- principal ----------

    private static string Principal(string userId, params string[] roles) =>
        Convert.ToBase64String(Encoding.UTF8.GetBytes(new JsonObject
        {
            ["identityProvider"] = "github", ["userId"] = userId, ["userDetails"] = "alice",
            ["userRoles"] = new JsonArray(roles.Select(r => (JsonNode?)r).ToArray()),
        }.ToJsonString()));

    [Fact]
    public void Principal_requires_authenticated_role_and_valid_header()
    {
        Assert.Equal(Alice, ClientPrincipal.Parse(Principal(Alice, "anonymous", "authenticated"))!.UserId);
        Assert.Null(ClientPrincipal.Parse(Principal(Alice, "anonymous")));
        Assert.Null(ClientPrincipal.Parse("not-base64!"));
        Assert.Null(ClientPrincipal.Parse(null));
        Assert.Null(ClientPrincipal.Parse(Convert.ToBase64String("[]"u8.ToArray())));
    }

    // ---------- migration ----------

    [Fact]
    public async Task Old_v1_document_is_read_as_items_and_rewritten_as_v2()
    {
        _decks.Seed(Alice, JsonNode.Parse("""
            { "id": "old", "userId": "alice-id", "name": "Cũ", "description": "", "level": "A2", "schemaVersion": 1,
              "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z",
              "words": [ { "id": "w1", "word": "apple", "meaning": "quả táo", "example": "An apple a day.", "ipa": "/ˈæp.əl/" },
                         { "word": "cat", "meaning": "con mèo", "example": "" } ] }
            """)!.AsObject());

        var deck = await Decks.GetAsync(Alice, "old", _ct);
        Assert.Equal(2, (int)deck["schemaVersion"]!);
        Assert.Null(deck["words"]);
        Assert.Null(deck["userId"]);
        var first = deck["items"]![0]!;
        Assert.Equal("word", (string?)first["type"]);
        Assert.Equal("apple", (string?)first["text"]);
        Assert.Equal("An apple a day.", (string?)first["examples"]![0]!["en"]);
        Assert.Empty(deck["items"]![1]!["examples"]!.AsArray());

        // Writing it back stores v2.
        var updated = await Decks.UpdateAsync(Alice, "old", deck, (string?)deck["_etag"], _ct);
        var raw = (await _decks.ReadAsync(Alice, "old", _ct))!.Doc;
        Assert.Equal(2, (int)raw["schemaVersion"]!);
        Assert.Null(raw["words"]);
        Assert.Equal("2026-01-01T00:00:00Z", (string?)raw["createdAt"]);
        Assert.NotEqual(deck["_etag"]!.ToString(), updated["_etag"]!.ToString());
    }

    // ---------- validation ----------

    [Theory]
    [InlineData("collocation", "heavy", false)]
    [InlineData("collocation", "heavy rain", true)]
    [InlineData("phrasal_verb", "look", false)]
    [InlineData("phrasal_verb", "look into", true)]
    [InlineData("idiom", "break the ice", true)]
    [InlineData("noun", "cat", false)]
    public async Task Items_are_validated_by_type(string type, string text, bool valid)
    {
        var body = DeckBody("D", Item("i1", type, text));
        if (valid) Assert.NotNull(await Decks.CreateAsync(Alice, body, _ct));
        else Assert.Equal(400, (await Fails(() => Decks.CreateAsync(Alice, body, _ct))).Status);
    }

    [Fact]
    public async Task Wrong_particles_only_for_phrasal_verbs_and_examples_capped()
    {
        var item = Item("i1", "collocation", "heavy rain");
        item["distractors"] = new JsonObject { ["wrongCollocations"] = new JsonArray("strong rain"), ["wrongParticles"] = new JsonArray("up"), ["wrongSentences"] = new JsonArray() };
        Assert.Contains("phrasal verb", (await Fails(() => Decks.CreateAsync(Alice, DeckBody("D", item), _ct))).Message);

        var many = Item("i2", "word", "rain");
        many["examples"] = new JsonArray(Enumerable.Range(0, 6).Select(i => (JsonNode?)new JsonObject { ["en"] = $"e{i}", ["vi"] = "" }).ToArray());
        Assert.Equal(400, (await Fails(() => Decks.CreateAsync(Alice, DeckBody("D", many), _ct))).Status);
    }

    [Fact]
    public async Task Server_owns_user_and_timestamps()
    {
        var body = DeckBody();
        body["userId"] = Bob;
        body["createdAt"] = "1999-01-01T00:00:00Z";
        var deck = await Decks.CreateAsync(Alice, body, _ct);
        var raw = (await _decks.ReadAsync(Alice, (string)deck["id"]!, _ct))!.Doc;
        Assert.Equal(Alice, (string?)raw["userId"]);
        Assert.StartsWith("2026-10-23", (string?)raw["createdAt"]);
        Assert.Null(await _decks.ReadAsync(Bob, (string)deck["id"]!, _ct));
    }

    // ---------- permissions ----------

    [Fact]
    public async Task User_b_cannot_read_change_or_delete_user_a_deck()
    {
        var deck = await Decks.CreateAsync(Alice, DeckBody(), _ct);
        var id = (string)deck["id"]!;

        Assert.Equal(404, (await Fails(() => Decks.GetAsync(Bob, id, _ct))).Status);
        Assert.Equal(404, (await Fails(() => Decks.UpdateAsync(Bob, id, DeckBody("Hacked"), (string?)deck["_etag"], _ct))).Status);
        Assert.Equal(404, (await Fails(() => Decks.DeleteAsync(Bob, id, _ct))).Status);
        Assert.Equal(404, (await Fails(() => Shares.CreateAsync(Bob, id, _ct))).Status);
        Assert.Empty(await Decks.ListAsync(Bob, _ct));
        Assert.Equal("Travel", (string?)(await Decks.GetAsync(Alice, id, _ct))["name"]);
    }

    [Fact]
    public async Task Progress_is_separate_per_user()
    {
        await Progress.MergeAsync(Alice, "d1", Batch("i1|en-vi", "2026-10-23T08:00:00Z"), _ct);
        Assert.Empty((await Progress.GetAsync(Bob, "d1", _ct))["cards"]!.AsObject());
        Assert.Single((await Progress.GetAsync(Alice, "d1", _ct))["cards"]!.AsObject());
    }

    // ---------- concurrency ----------

    [Fact]
    public async Task Stale_etag_returns_412_with_current_version()
    {
        var deck = await Decks.CreateAsync(Alice, DeckBody(), _ct);
        var id = (string)deck["id"]!;
        var etag = (string?)deck["_etag"];
        await Decks.UpdateAsync(Alice, id, DeckBody("Tab 1"), etag, _ct);

        var e = await Fails(() => Decks.UpdateAsync(Alice, id, DeckBody("Tab 2"), etag, _ct));
        Assert.Equal(412, e.Status);
        Assert.Equal("Tab 1", (string?)e.Current!["name"]);

        // Keeping "mine" = resend with the current etag.
        var kept = await Decks.UpdateAsync(Alice, id, DeckBody("Tab 2"), (string?)e.Current["_etag"], _ct);
        Assert.Equal("Tab 2", (string?)kept["name"]);
        Assert.Equal(428, (await Fails(() => Decks.UpdateAsync(Alice, id, DeckBody(), null, _ct))).Status);
    }

    // ---------- limits ----------

    [Fact]
    public async Task At_most_50_decks_per_user()
    {
        for (var i = 0; i < 50; i++) await Decks.CreateAsync(Alice, DeckBody($"D{i}"), _ct);
        var e = await Fails(() => Decks.CreateAsync(Alice, DeckBody("D50"), _ct));
        Assert.Equal(409, e.Status);
        Assert.NotNull(await Decks.CreateAsync(Bob, DeckBody(), _ct));
        Assert.Equal(50, (await Decks.ListAsync(Alice, _ct)).Count);
    }

    [Fact]
    public async Task At_most_500_items_and_field_lengths()
    {
        JsonObject[] Items(int n) => Enumerable.Range(0, n).Select(i => Item($"i{i}", "word", $"w{i}")).ToArray();
        Assert.Contains("500", (await Fails(() => Decks.CreateAsync(Alice, DeckBody("Big", Items(501)), _ct))).Message);
        Assert.NotNull(await Decks.CreateAsync(Alice, DeckBody("Ok", Items(500)), _ct));
        Assert.Equal(400, (await Fails(() => Decks.CreateAsync(Alice, DeckBody(new string('n', 81)), _ct))).Status);
        Assert.Equal(400, (await Fails(() => Decks.CreateAsync(Alice, DeckBody("D", Item("x", "word", new string('t', 81))), _ct))).Status);
        Assert.Equal(400, (await Fails(() => Decks.CreateAsync(Alice, DeckBody("D", Item("a", "word", "x"), Item("a", "word", "y")), _ct))).Status);
    }

    // ---------- progress batches ----------

    private static JsonObject Card(string lastReview, double stability = 3) => new()
    {
        ["due"] = "2026-10-26T08:00:00Z", ["stability"] = stability, ["difficulty"] = 5, ["scheduled_days"] = 3,
        ["learning_steps"] = 0, ["reps"] = 1, ["lapses"] = 0, ["state"] = 2, ["last_review"] = lastReview,
    };

    private static JsonObject Day(int reviews, int again, string type = "word") => new()
    {
        ["reviews"] = reviews, ["again"] = again, ["newCards"] = 0,
        ["byType"] = new JsonObject { [type] = new JsonArray(reviews, reviews - again) },
    };

    private static JsonObject Batch(string key, string lastReview, double stability = 3) => new()
    {
        ["cards"] = new JsonObject { [key] = Card(lastReview, stability) },
        ["days"] = new JsonObject { ["2026-10-23"] = Day(1, 0) },
    };

    [Fact]
    public async Task Batches_merge_newer_cards_and_add_day_counters()
    {
        await Progress.MergeAsync(Alice, "d1", Batch("i1|en-vi", "2026-10-23T08:00:00Z", 3), _ct);
        await Progress.MergeAsync(Alice, "d1", Batch("i1|en-vi", "2026-10-22T08:00:00Z", 99), _ct); // older review: ignored
        var batch = Batch("i2|cloze", "2026-10-23T09:00:00Z");
        batch["days"] = new JsonObject { ["2026-10-23"] = Day(2, 1, "idiom"), ["2026-07-01"] = Day(5, 0) };
        var p = await Progress.MergeAsync(Alice, "d1", batch, _ct);

        Assert.Equal(3, (double)p["cards"]!["i1|en-vi"]!["stability"]!);
        Assert.NotNull(p["cards"]!["i2|cloze"]);
        Assert.Equal(4, (int)p["days"]!["2026-10-23"]!["reviews"]!); // 1 + 1 + 2
        Assert.Equal(1, (int)p["days"]!["2026-10-23"]!["byType"]!["idiom"]![1]!);
        Assert.Null(p["days"]!["2026-07-01"]); // older than 60 days
        Assert.Equal(1, _progress.Count);
    }

    [Theory]
    [InlineData("""{ "cards": { "bad key": {} } }""")]
    [InlineData("""{ "cards": { "i1|essay": { "due": "2026-10-23T00:00:00Z" } } }""")]
    [InlineData("""{ "cards": { "i1|en-vi": { "due": "soon", "stability": 1, "difficulty": 1, "scheduled_days": 1, "learning_steps": 0, "reps": 1, "lapses": 0, "state": 2 } } }""")]
    [InlineData("""{ "days": { "yesterday": { "reviews": 1, "again": 0, "newCards": 0 } } }""")]
    [InlineData("""{ "days": { "2026-10-23": { "reviews": -1, "again": 0, "newCards": 0 } } }""")]
    [InlineData("""{ }""")]
    public async Task Invalid_batches_are_rejected(string json) =>
        Assert.Equal(400, (await Fails(() => Progress.MergeAsync(Alice, "d1", JsonNode.Parse(json)!.AsObject(), _ct))).Status);

    [Fact]
    public async Task Deleting_a_deck_removes_its_progress()
    {
        var deck = await Decks.CreateAsync(Alice, DeckBody(), _ct);
        var id = (string)deck["id"]!;
        await Progress.MergeAsync(Alice, id, Batch("i1|en-vi", "2026-10-23T08:00:00Z"), _ct);
        await Decks.DeleteAsync(Alice, id, _ct);
        Assert.Equal(0, _progress.Count);
    }

    // ---------- shares ----------

    [Fact]
    public async Task Share_codes_are_8_chars_with_30_day_ttl_and_public()
    {
        var deck = await Decks.CreateAsync(Alice, DeckBody(), _ct);
        var share = await Shares.CreateAsync(Alice, (string)deck["id"]!, _ct);
        var code = (string)share["code"]!;
        Assert.Matches("^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$", code);
        var raw = (await _shares.ReadAsync(code, code, _ct))!.Doc;
        Assert.Equal(2_592_000, (int)raw["ttl"]!);
        Assert.Null(raw["deck"]!["userId"]);

        var got = await Shares.GetAsync(code.ToLowerInvariant(), _ct);
        Assert.Equal("Travel", (string?)got["deck"]!["name"]);
        Assert.Equal(404, (await Fails(() => Shares.GetAsync("ZZZZZZZZ", _ct))).Status);
        Assert.Equal(400, (await Fails(() => Shares.GetAsync("../x", _ct))).Status);
    }
}
