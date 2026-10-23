using System.Text.Json.Nodes;
using VocabBattle.Api.Core;
using static VocabBattle.Api.Tests.Fixtures;

namespace VocabBattle.Api.Tests;

public class AiTaskTests
{
    private static AiTasksService Service(ScriptedProvider p) => new(new StructuredService(p), Options());

    private static string Item(string type, string text, string meaning = "nghĩa", string example = "") => $$"""
        { "type": "{{type}}", "text": "{{text}}", "meaning": "{{meaning}}", "partOfSpeech": "", "ipa": "",
          "examples": [{ "en": "{{(example == "" ? text + " here." : example)}}", "vi": "ví dụ" }], "note": "" }
        """;

    [Fact]
    public async Task Generate_deck_uses_server_prompt_and_schema_and_trims_to_count()
    {
        var items = string.Join(",", Enumerable.Range(0, 14).Select(i => Item("word", $"w{i}")));
        var p = new ScriptedProvider($$"""{ "name": "Du lịch", "description": "Từ vựng du lịch", "items": [{{items}}] }""");

        var r = await Service(p).GenerateDeckAsync(new("travel", "B1", 10), CancellationToken.None);

        Assert.Equal(10, r.Value["items"]!.AsArray().Count);
        Assert.Equal("B1", (string?)r.Value["level"]);
        var req = p.Requests.Single();
        Assert.Equal(AiShared.Prompts.Tasks["generateDeck"].System, req.System);
        Assert.Contains("Topic: travel", req.User);
        Assert.Contains("Number of items: 10", req.User);
        Assert.Equal("deck", req.SchemaName);
        Assert.Equal(4000, req.MaxTokens);
        // Empty optional fields are dropped, tags added.
        var first = r.Value["items"]![0]!.AsObject();
        Assert.False(first.ContainsKey("ipa"));
        Assert.Empty(first["tags"]!.AsArray());
    }

    [Theory]
    [InlineData("", "B1", 10)]
    [InlineData("travel", "Z1", 10)]
    [InlineData("travel", "B1", 9)]
    [InlineData("travel", "B1", 31)]
    public async Task Generate_deck_rejects_bad_input_without_calling_provider(string topic, string level, int count)
    {
        var p = new ScriptedProvider();
        await Assert.ThrowsAsync<InputException>(() => Service(p).GenerateDeckAsync(new(topic, level, count), CancellationToken.None));
        Assert.Throws<InputException>(() => AiTasksService.Precheck(new GenerateDeckInput(topic, level, count)));
        Assert.Equal(0, p.Calls);
    }

    [Fact]
    public async Task Suggest_phrases_drops_single_words_duplicates_and_bad_types()
    {
        var p = new ScriptedProvider($$"""
            { "items": [ {{Item("collocation", "heavy rain")}}, {{Item("word", "rain")}}, {{Item("idiom", "rain cats and dogs")}},
                         {{Item("collocation", "Heavy rain")}}, {{Item("phrasal_verb", "rain off")}} ] }
            """);
        var r = await Service(p).SuggestPhrasesAsync(new("Rain"), CancellationToken.None);
        var texts = r.Value["items"]!.AsArray().Select(x => (string?)x!["text"]).ToList();
        Assert.Equal(["heavy rain", "rain cats and dogs", "rain off"], texts);
        Assert.Contains("Word: rain", p.Requests[0].User);
    }

    [Fact]
    public async Task Invalid_output_is_retried_once_then_fails()
    {
        var p = new ScriptedProvider("""{ "items": [{ "type": "word" }] }""", "not json");
        var e = await Assert.ThrowsAsync<StructuredFormatException>(() => Service(p).SuggestPhrasesAsync(new("rain"), CancellationToken.None));
        Assert.Equal(2, p.Calls);
        Assert.Equal(new AiUsage(200, 100), e.Usage);
    }

    [Fact]
    public async Task Extract_items_limits_passage_length()
    {
        var p = new ScriptedProvider($$"""{ "items": [ {{Item("phrasal_verb", "look into")}} ] }""");
        await Assert.ThrowsAsync<InputException>(() =>
            Service(p).ExtractItemsAsync(new(new string('a', 2001), "B1"), CancellationToken.None));
        var r = await Service(p).ExtractItemsAsync(new("The police looked into the case.", "B2"), CancellationToken.None);
        Assert.Single(r.Value["items"]!.AsArray());
        Assert.Contains("looked into the case", p.Requests[0].User);
    }

    [Fact]
    public async Task Distractors_keep_input_order_and_only_phrasal_verbs_get_particles()
    {
        var p = new ScriptedProvider("""
            { "results": [
              { "text": "make a decision", "wrongCollocations": ["do a decision", "make a decision", "do a decision"], "wrongParticles": ["up"], "wrongSentences": ["I did a decision."] },
              { "text": "look into", "wrongCollocations": [], "wrongParticles": ["at", "into", "after", "up"], "wrongSentences": [] }
            ] }
            """);
        var r = await Service(p).GenerateDistractorsAsync(
            new([new("phrasal_verb", "look into", "điều tra"), new("collocation", "make a decision", "quyết định")]), CancellationToken.None);

        var results = r.Value["results"]!.AsArray();
        Assert.Equal("look into", (string?)results[0]!["text"]);
        Assert.Equal(["at", "after", "up"], results[0]!["wrongParticles"]!.AsArray().Select(x => (string?)x));
        Assert.Equal(["do a decision"], results[1]!["wrongCollocations"]!.AsArray().Select(x => (string?)x));
        Assert.Empty(results[1]!["wrongParticles"]!.AsArray());
    }

    [Fact]
    public void Distractors_reject_too_many_or_bad_items()
    {
        Assert.Throws<InputException>(() => AiTasksService.Precheck(new DistractorsInput([])));
        Assert.Throws<InputException>(() => AiTasksService.Precheck(new DistractorsInput(
            Enumerable.Range(0, 11).Select(i => new DistractorItem("word", $"w{i}", "m")).ToList())));
        Assert.Throws<InputException>(() => AiTasksService.Precheck(new DistractorsInput([new("verb", "x", "m")])));
    }

    [Fact]
    public void Every_task_schema_is_strict()
    {
        foreach (var name in new[] { "lookup", "items", "deck", "distractors" })
        {
            AssertStrict(AiShared.SchemaNode(name), name);
        }
    }

    /// <summary>Structured outputs need additionalProperties:false and every property required on every object.</summary>
    private static void AssertStrict(JsonNode node, string path)
    {
        if (node is JsonObject o)
        {
            if (o["type"] is JsonValue t && (string?)t == "object")
            {
                Assert.False((bool?)o["additionalProperties"] ?? true, path);
                var props = o["properties"]!.AsObject().Select(p => p.Key).Order();
                Assert.Equal(props, o["required"]!.AsArray().Select(x => (string)x!).Order());
            }
            foreach (var (k, v) in o) if (v is not null) AssertStrict(v, $"{path}.{k}");
        }
        else if (node is JsonArray a)
        {
            foreach (var v in a) if (v is not null) AssertStrict(v, path);
        }
    }
}
