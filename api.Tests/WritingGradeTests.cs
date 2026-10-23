using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Time.Testing;
using VocabBattle.Api.Core;
using VocabBattle.Api.Core.Data;
using VocabBattle.Api.Core.Writing;

namespace VocabBattle.Api.Tests;

/// <summary>Replies per schema (grading runs two calls in parallel), recording each request.</summary>
public sealed class SchemaProvider : IAiProvider
{
    private readonly ConcurrentDictionary<string, ConcurrentQueue<Func<string>>> _replies = new();
    public ConcurrentBag<StructuredRequest> Requests { get; } = [];
    public string Name => "fake";
    public string Model => "main-model";

    public SchemaProvider On(string schema, params string[] outputs)
    {
        var q = _replies.GetOrAdd(schema, _ => new());
        foreach (var o in outputs) q.Enqueue(() => o);
        return this;
    }

    public SchemaProvider Fail(string schema, AiProviderException e)
    {
        _replies.GetOrAdd(schema, _ => new()).Enqueue(() => throw e);
        return this;
    }

    public Task<StructuredRaw> GenerateJsonAsync(StructuredRequest request, CancellationToken ct)
    {
        Requests.Add(request);
        if (!_replies.TryGetValue(request.SchemaName, out var q) || !q.TryDequeue(out var next)) throw new InvalidOperationException("no reply for " + request.SchemaName);
        return Task.FromResult(new StructuredRaw(next(), new AiUsage(1000, 500)));
    }

    public IAsyncEnumerable<ChatEvent> StreamChatAsync(string system, IReadOnlyList<ChatMessage> messages, CancellationToken ct) =>
        throw new NotSupportedException();
}

public sealed class WritingGradeTests
{
    private static string Crit(double score) => $$"""{"score":{{score.ToString(System.Globalization.CultureInfo.InvariantCulture)}},"comment":"Nhận xét cụ thể.","evidence":["He go to school"]}""";

    internal static string Grade(double tf = 7, double org = 6, double voc = 6, double gra = 5.5, double overall = 9.5) => $$"""
    {"criteria":{"taskFulfilment":{{Crit(tf)}},"organization":{{Crit(org)}},"vocabulary":{{Crit(voc)}},"grammar":{{Crit(gra)}}},
     "overallScore":{{overall.ToString(System.Globalization.CultureInfo.InvariantCulture)}},
     "errors":[{"quote":"He go","occurrence":1,"category":"grammar","rule":"subject_verb","severity":"major","correction":"He goes","explanationVi":"Chủ ngữ số ít."},
               {"quote":"to school","occurrence":1,"category":"grammar","rule":"article","severity":"minor","correction":"to the school","explanationVi":"x"}],
     "strengths":["a","b","c","d"],"improvements":["e"]}
    """;

    internal const string Rewrite = """
    {"rewrite":"He goes to school every day.","usefulPhrases":[
      {"text":"go to school","type":"collocation","meaningVi":"đi học","example":"He goes to school every day."},
      {"text":"Go To School","type":"collocation","meaningVi":"trùng","example":""},
      {"text":"every day","type":"word","meaningVi":"","example":""}]}
    """;

    internal static readonly PromptDto Prompt = new("Homework", "Some people think homework should be banned. To what extent do you agree?", "education", "opinion", null, null, "ai");

    internal const string Sentence = "He go to school every day and he like it very much. ";

    /// <summary>300 words by default (above the Task 2 minimum).</summary>
    internal static CheckedGrade Input(string? essay = null, int task = 2) =>
        WritingService.CheckGrade(new GradeWritingInput(task, "B2", Prompt, essay ?? string.Concat(Enumerable.Repeat(Sentence, 25)), 600, null));

    private static AiOptions Options => Fixtures.Options() with { GradingModel = "grading-model", GradingEffort = "high", GradingMaxTokens = 7000 };

    [Fact]
    public void Scores_round_to_half_points_and_weight_task_2_double()
    {
        Assert.Equal(6.5, WritingScoring.TaskScore([7, 6.5, 6, 5.5])); // 6.25
        Assert.Equal(5, WritingScoring.TaskScore([5, 5, 5, 5.5])); // 5.125
        Assert.Equal(6.5, WritingScoring.WritingScore(6, 7)); // 6.67
        Assert.Equal(6, WritingScoring.WritingScore(8, 5));
        Assert.Equal(6, WritingScoring.WritingScore(0, 9));
        Assert.Equal(10, WritingScoring.Clamp(12));
        Assert.Equal(0, WritingScoring.Clamp(double.NaN));
        Assert.Equal(5, WritingScoring.ShortEssayCap(125, 250));
    }

    [Theory]
    [InlineData(0, "none")]
    [InlineData(3.5, "none")]
    [InlineData(4, "B1")]
    [InlineData(5.5, "B1")]
    [InlineData(6, "B2")]
    [InlineData(8, "B2")]
    [InlineData(8.5, "C1")]
    [InlineData(10, "C1")]
    public void Levels_follow_the_configured_bands(double score, string band) => Assert.Equal(band, WritingScoring.Band(score));

    [Fact]
    public async Task Grading_recomputes_the_total_and_uses_the_grading_model()
    {
        var provider = new SchemaProvider().On("writing_grade", Grade()).On("writing_rewrite", Rewrite);
        var service = new WritingService(new StructuredService(provider), Options);
        var r = await service.GradeAsync(Input(), CancellationToken.None);

        Assert.Equal(6, (double)r.Value["taskScore"]!); // mean 6.125 → 6, not the model's 9.5
        Assert.Equal("B2", (string?)r.Value["band"]);
        Assert.Equal("grading-model", (string?)r.Value["model"]);
        Assert.Equal(3, r.Value["strengths"]!.AsArray().Count);
        Assert.Equal("article", (string?)r.Value["errors"]![1]!["rule"]);
        Assert.Single(r.Value["usefulPhrases"]!.AsArray());
        Assert.Equal("He goes to school every day.", (string?)r.Value["rewrite"]);
        Assert.Equal(new AiUsage(2000, 1000), r.Usage);
        Assert.All(provider.Requests, req =>
        {
            Assert.Equal("grading-model", req.Model);
            Assert.Equal("high", req.Effort);
            Assert.Null(req.Temperature);
            Assert.Equal(7000, req.MaxTokens);
        });
        var gradeReq = provider.Requests.Single(x => x.SchemaName == "writing_grade");
        Assert.Equal(AiShared.Prompts.Tasks["writingGrade"].System, gradeReq.System);
        Assert.Contains("Word count of the essay: 300", gradeReq.User);
    }

    [Fact]
    public async Task Invalid_output_is_retried_once_then_reported()
    {
        var retried = new SchemaProvider().On("writing_grade", "{\"criteria\":{}}", Grade()).On("writing_rewrite", Rewrite);
        var ok = await new WritingService(new StructuredService(retried), Options).GradeAsync(Input(), CancellationToken.None);
        Assert.Equal(6, (double)ok.Value["taskScore"]!);
        Assert.Equal(2, retried.Requests.Count(r => r.SchemaName == "writing_grade"));

        var broken = new SchemaProvider().On("writing_grade", "not json", "{\"overallScore\":5}").On("writing_rewrite", Rewrite);
        var e = await Assert.ThrowsAsync<StructuredFormatException>(() =>
            new WritingService(new StructuredService(broken), Options).GradeAsync(Input(), CancellationToken.None));
        Assert.Equal(new AiUsage(3000, 1500), e.Usage); // both grading attempts + the rewrite are still counted
    }

    [Fact]
    public async Task A_failed_rewrite_still_returns_the_scores()
    {
        var provider = new SchemaProvider().On("writing_grade", Grade()).Fail("writing_rewrite", new AiProviderException("Hết thời gian.", 504));
        var r = await new WritingService(new StructuredService(provider), Options).GradeAsync(Input(), CancellationToken.None);
        Assert.Null((string?)r.Value["rewrite"]);
        Assert.Equal("Hết thời gian.", (string?)r.Value["rewriteError"]);
        Assert.Empty(r.Value["usefulPhrases"]!.AsArray());
    }

    [Fact]
    public async Task Short_essays_get_a_capped_task_fulfilment_score()
    {
        var provider = new SchemaProvider().On("writing_grade", Grade(tf: 9, org: 7, voc: 7, gra: 7)).On("writing_rewrite", Rewrite);
        var r = await new WritingService(new StructuredService(provider), Options).GradeAsync(Input(Sentence), CancellationToken.None);
        // 12 words of 250 → cap 0.5
        Assert.True((bool)r.Value["shortPenalty"]!);
        Assert.Equal(0.5, (double)r.Value["criteria"]!["taskFulfilment"]!["score"]!);
        Assert.Equal(5.5, (double)r.Value["taskScore"]!); // (0.5+7+7+7)/4 = 5.375
    }

    [Fact]
    public async Task Grading_quota_is_per_user_in_the_database_and_per_ip_otherwise()
    {
        var time = new FakeTimeProvider(DateTimeOffset.Parse("2026-10-23T08:00:00Z"));
        var writings = new InMemoryStore();
        var stores = new DataStores(new InMemoryStore(), new InMemoryStore(), new InMemoryStore(), writings);
        var store = new WritingStore(stores, time);
        var options = Fixtures.Options() with { WritingGradePerDay = 10, WritingGradePerDayAnon = 3 };
        var quota = new WritingQuota(options, new IpRateLimiter(time), store, time);
        var result = WritingService.BuildResult(JsonNode.Parse(Grade())!, JsonNode.Parse(Rewrite), 2, "B2", 12, "m", time.GetUtcNow());

        for (var i = 0; i < 10; i++)
        {
            Assert.Null(await quota.CheckAsync("alice", "1.1.1.1", default));
            await store.SaveAsync("alice", Input(), result, default);
        }
        var blocked = await quota.CheckAsync("alice", "1.1.1.1", default);
        Assert.Equal(429, blocked?.StatusCode);
        Assert.Contains("10 lượt chấm bài", blocked!.Message);
        Assert.Null(await quota.CheckAsync("bob", "1.1.1.1", default)); // other users are not affected

        // Anonymous: 3 per IP per day, in memory; the signed-in quota is separate.
        for (var i = 0; i < 3; i++) Assert.Null(await quota.CheckAsync(null, "2.2.2.2", default));
        Assert.Equal(429, (await quota.CheckAsync(null, "2.2.2.2", default))?.StatusCode);
        Assert.Null(await quota.CheckAsync(null, "3.3.3.3", default));

        // A new UTC day resets both.
        time.Advance(TimeSpan.FromDays(1));
        Assert.Null(await quota.CheckAsync("alice", "1.1.1.1", default));
        Assert.Null(await quota.CheckAsync(null, "2.2.2.2", default));
    }

    [Fact]
    public async Task Without_a_database_signed_in_users_fall_back_to_a_memory_quota()
    {
        var time = new FakeTimeProvider(DateTimeOffset.Parse("2026-10-23T08:00:00Z"));
        var none = new UnavailableStore();
        var quota = new WritingQuota(Fixtures.Options() with { WritingGradePerDay = 2 }, new IpRateLimiter(time),
            new WritingStore(new DataStores(none, none, none, none), time), time);
        Assert.Null(await quota.CheckAsync("alice", "1.1.1.1", default));
        Assert.Null(await quota.CheckAsync("alice", "1.1.1.1", default));
        Assert.Equal(429, (await quota.CheckAsync("alice", "1.1.1.1", default))?.StatusCode);
    }
}

public sealed class WritingResultCleaningTests
{
    [Fact]
    public void Unknown_rules_categories_and_bad_occurrences_are_cleaned()
    {
        var grade = JsonNode.Parse("""
        {"criteria":{},"errors":[
          {"quote":"a","occurrence":0,"category":"grammar","rule":"made_up","severity":"huge","correction":"b","explanationVi":""},
          {"quote":"","occurrence":1,"category":"grammar","rule":"article","severity":"minor","correction":"","explanationVi":""},
          {"quote":"c","occurrence":2.7,"category":"nonsense","rule":"article","severity":"minor","correction":"","explanationVi":""}]}
        """)!;
        var r = WritingService.BuildResult(grade, null, 1, "B1", 130, "m", DateTimeOffset.UnixEpoch);
        var errors = r["errors"]!.AsArray();
        Assert.Single(errors);
        Assert.Equal("other", (string?)errors[0]!["rule"]);
        Assert.Equal("minor", (string?)errors[0]!["severity"]);
        Assert.Equal(1, (int?)errors[0]!["occurrence"]);
        Assert.Equal(0, (double)r["taskScore"]!);
        Assert.Equal("none", (string?)r["band"]);
        Assert.False((bool)r["shortPenalty"]!);
        Assert.NotNull((string?)r["rewriteError"]);
    }
}
