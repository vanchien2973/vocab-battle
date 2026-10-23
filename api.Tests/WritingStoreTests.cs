using System.Text.Json.Nodes;
using Microsoft.Extensions.Time.Testing;
using VocabBattle.Api.Core.Data;
using VocabBattle.Api.Core.Writing;

namespace VocabBattle.Api.Tests;

public sealed class WritingStoreTests
{
    private readonly FakeTimeProvider _time = new(DateTimeOffset.Parse("2026-10-23T08:00:00Z"));
    private readonly InMemoryStore _writings = new();
    private WritingStore Store => new(new DataStores(new InMemoryStore(), new InMemoryStore(), new InMemoryStore(), _writings), _time);

    private JsonObject Result(string grade) =>
        WritingService.BuildResult(JsonNode.Parse(grade)!, JsonNode.Parse(WritingGradeTests.Rewrite), 2, "B2", 300, "m", _time.GetUtcNow());

    [Fact]
    public async Task Attempts_are_numbered_per_prompt_and_saved_in_the_user_partition()
    {
        var store = Store;
        var first = await store.SaveAsync("alice", WritingGradeTests.Input(), Result(WritingGradeTests.Grade()), default);
        _time.Advance(TimeSpan.FromMinutes(5));
        var second = await store.SaveAsync("alice", WritingGradeTests.Input(), Result(WritingGradeTests.Grade()), default);
        var other = await store.SaveAsync("alice", WritingService.CheckGrade(new GradeWritingInput(2, "B2",
            WritingGradeTests.Prompt with { Text = "A different prompt." }, "Some words here.", 60, "exam-1")), Result(WritingGradeTests.Grade()), default);

        Assert.Equal(1, (int)first["attempt"]!);
        Assert.Equal(2, (int)second["attempt"]!);
        Assert.Equal(1, (int)other["attempt"]!);
        Assert.Equal((string?)first["promptId"], (string?)second["promptId"]);
        Assert.Matches("^w-[a-f0-9]{32}$", (string)first["id"]!);

        var doc = await store.GetAsync("alice", (string)second["id"]!, default);
        Assert.Null(doc["userId"]);
        Assert.Equal(2, (int)doc["attempt"]!);
        Assert.Equal(300, (int)doc["wordCount"]!);
        Assert.Equal("education", (string?)doc["topic"]);

        var history = await store.HistoryAsync("alice", default);
        var summaries = history["summaries"]!.AsArray();
        Assert.Equal(3, summaries.Count);
        Assert.Equal("exam-1", (string?)summaries[2]!["examId"]);
        Assert.Equal(6, (double)summaries[0]!["taskScore"]!);
        Assert.Equal(7, (double)summaries[0]!["criteria"]!["taskFulfilment"]!);
        Assert.Equal(3, (int)history["stats"]!["writings"]!);
        Assert.Equal(6, (int)history["stats"]!["categories"]!["grammar"]!); // 2 grammar errors × 3
        Assert.Equal(3, (int)history["stats"]!["rules"]!["subject_verb"]!);
    }

    [Fact]
    public async Task Users_cannot_read_or_delete_each_others_essays()
    {
        var store = Store;
        var saved = await store.SaveAsync("alice", WritingGradeTests.Input(), Result(WritingGradeTests.Grade()), default);
        var id = (string)saved["id"]!;

        var read = await Assert.ThrowsAsync<DataException>(() => store.GetAsync("mallory", id, default));
        Assert.Equal(404, read.Status);
        var delete = await Assert.ThrowsAsync<DataException>(() => store.DeleteAsync("mallory", id, default));
        Assert.Equal(404, delete.Status);
        Assert.Empty((await store.HistoryAsync("mallory", default))["summaries"]!.AsArray());
        Assert.NotNull(await store.GetAsync("alice", id, default));

        Assert.Equal(400, (await Assert.ThrowsAsync<DataException>(() => store.GetAsync("alice", "index", default))).Status);
        Assert.Equal(400, (await Assert.ThrowsAsync<DataException>(() => store.GetAsync("alice", "../x", default))).Status);
    }

    [Fact]
    public async Task Deleting_removes_the_summary_and_its_error_counts()
    {
        var store = Store;
        var a = await store.SaveAsync("alice", WritingGradeTests.Input(), Result(WritingGradeTests.Grade()), default);
        await store.SaveAsync("alice", WritingGradeTests.Input(), Result("""{"criteria":{},"errors":[]}"""), default);

        await store.DeleteAsync("alice", (string)a["id"]!, default);
        var history = await store.HistoryAsync("alice", default);
        Assert.Single(history["summaries"]!.AsArray());
        Assert.Equal(1, (int)history["stats"]!["writings"]!);
        Assert.Empty(history["stats"]!["categories"]!.AsObject());
        await Assert.ThrowsAsync<DataException>(() => store.GetAsync("alice", (string)a["id"]!, default));
    }

    [Fact]
    public async Task History_keeps_the_newest_summaries_only()
    {
        var store = Store;
        var limit = VstepConfig.Current.HistoryLimit;
        var result = Result("""{"criteria":{},"errors":[]}""");
        for (var i = 0; i < limit + 2; i++) await store.SaveAsync("alice", WritingGradeTests.Input(), result, default);
        var summaries = (await store.HistoryAsync("alice", default))["summaries"]!.AsArray();
        Assert.Equal(limit, summaries.Count);
        Assert.Equal(limit + 2, (int)summaries[^1]!["attempt"]!);
    }
}
