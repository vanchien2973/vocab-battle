using System.Text.Json;
using System.Text.Json.Nodes;
using VocabBattle.Api.Core;
using VocabBattle.Api.Core.Writing;

namespace VocabBattle.Api.Tests;

public sealed class WritingTests
{
    /// <summary>fixtures/vstep in the repository (the same files the Vitest suite reads).</summary>
    internal static string FixturePath(string name)
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var path = Path.Combine(dir.FullName, "fixtures", "vstep", name);
            if (File.Exists(path)) return path;
        }
        throw new FileNotFoundException(name);
    }

    public static TheoryData<string, int> WordCountCases()
    {
        var data = new TheoryData<string, int>();
        foreach (var c in JsonNode.Parse(File.ReadAllText(FixturePath("word-count-cases.json")))!.AsArray())
            data.Add((string)c!["text"]!, (int)c["words"]!);
        return data;
    }

    [Theory]
    [MemberData(nameof(WordCountCases))]
    public void Word_count_matches_the_frontend_cases(string text, int words) =>
        Assert.Equal(words, WritingText.CountWords(text));

    [Fact]
    public void Prompt_ids_ignore_whitespace_and_match_the_frontend_format()
    {
        var a = WritingText.PromptId("Write an  email\nto your friend.");
        Assert.Matches("^[0-9a-f]{16}$", a);
        Assert.Equal(a, WritingText.PromptId(" Write an email to your friend. "));
        Assert.NotEqual(a, WritingText.PromptId("Write a letter."));
    }

    [Fact]
    public void Templates_are_filled_in_one_pass()
    {
        var filled = WritingText.Fill("{a} and {b} {c}", new Dictionary<string, string> { ["a"] = "{b}", ["b"] = "$&" });
        Assert.Equal("{b} and $& {c}", filled);
    }

    [Fact]
    public void Config_is_read_from_the_shared_file()
    {
        var c = VstepConfig.Current;
        Assert.Equal(120, c.Task(1).MinWords);
        Assert.Equal(250, c.Task(2).MinWords);
        Assert.Equal(60, c.ExamMinutes);
        Assert.Equal(600, c.MaxWords);
        Assert.Equal(["B1", "B2", "C1"], c.TargetLevels);
    }

    [Theory]
    [InlineData(3, "B2", "health")]
    [InlineData(2, "A1", "health")]
    [InlineData(2, "B2", "cooking")]
    [InlineData(null, "B2", "health")]
    public void Prompt_input_is_validated(int? task, string level, string topic) =>
        Assert.Throws<InputException>(() => WritingService.CheckPrompt(new WritingPromptInput(task, level, topic, null, null)));

    [Fact]
    public void Random_topic_and_essay_type_are_picked_server_side()
    {
        var (_, _, topic, essayType, avoid) = WritingService.CheckPrompt(
            new WritingPromptInput(2, "B2", "random", "", [.. Enumerable.Range(0, 20).Select(i => $"Prompt {i}"), "  "]));
        Assert.Contains(VstepConfig.Current.Topics, t => t.Id == topic);
        Assert.Contains(VstepConfig.Current.EssayTypes, t => t.Id == essayType);
        Assert.Equal(VstepConfig.Current.MaxAvoid, avoid.Count);
        Assert.Equal("", WritingService.CheckPrompt(new WritingPromptInput(1, "B1", "travel", "opinion", null)).EssayType);
    }

    [Fact]
    public async Task Generated_prompts_are_cleaned_and_use_the_fixed_prompt()
    {
        var output = """
        {"title":"  Email   to a friend ","text":"Dear Lan, I am coming to Hanoi... Write an email. You should write at least 120 words.",
         "requirements":["when you are free","", "where to go","what to bring"],"register":"informal","essayType":"opinion"}
        """;
        var provider = new ScriptedProvider(output);
        var service = new WritingService(new StructuredService(provider), Fixtures.Options());
        var r = await service.GeneratePromptAsync(new WritingPromptInput(1, "B1", "travel", null, ["Old {essay} prompt"]), CancellationToken.None);

        Assert.Equal("Email to a friend", (string?)r.Value["title"]);
        Assert.Equal(1, (int?)r.Value["task"]);
        Assert.Equal("travel", (string?)r.Value["topic"]);
        Assert.Equal("", (string?)r.Value["essayType"]);
        Assert.Equal("informal", (string?)r.Value["register"]);
        Assert.Equal(3, r.Value["requirements"]!.AsArray().Count);
        Assert.Equal("ai", (string?)r.Value["source"]);
        var req = provider.Requests.Single();
        Assert.Equal(AiShared.Prompts.Tasks["writingPrompt"].System.Replace("{minWords}", "120"), req.System);
        Assert.Contains("travel and tourism", req.User);
        Assert.Contains("- Old {essay} prompt", req.User);
        Assert.Equal("writing_prompt", req.SchemaName);
    }

    [Fact]
    public void Grade_input_is_validated()
    {
        var prompt = new PromptDto("Homework", "Some people think homework should be banned. Discuss.", "education", "opinion", null, null, "ai");
        Assert.Throws<InputException>(() => WritingService.CheckGrade(null));
        Assert.Throws<InputException>(() => WritingService.CheckGrade(new GradeWritingInput(2, "B2", prompt, "   ", 0, null)));
        Assert.Throws<InputException>(() => WritingService.CheckGrade(new GradeWritingInput(2, "B2", prompt, string.Concat(Enumerable.Repeat("word ", 601)), 0, null)));
        Assert.Throws<InputException>(() => WritingService.CheckGrade(new GradeWritingInput(2, "B2", prompt with { Text = "" }, "Hello.", 0, null)));
        Assert.Throws<InputException>(() => WritingService.CheckGrade(new GradeWritingInput(2, "B2", prompt with { Text = new string('x', 2001) }, "Hello.", 0, null)));
        Assert.Throws<InputException>(() => WritingService.CheckGrade(new GradeWritingInput(3, "B2", prompt, "Hello.", 0, null)));
        Assert.Throws<InputException>(() => WritingService.CheckGrade(new GradeWritingInput(2, "A2", prompt, "Hello.", 0, null)));
        Assert.Throws<InputException>(() => WritingService.CheckGrade(new GradeWritingInput(2, "B2", prompt, "Hello.", 0, "bad id!")));

        var ok = WritingService.CheckGrade(new GradeWritingInput(2, "C1", prompt with { Topic = "made-up", Register = "formal" }, "  He go to school. ", 99_999, "exam1"));
        Assert.Equal(4, ok.WordCount);
        Assert.Equal("He go to school.", ok.Essay);
        Assert.Equal("custom", (string?)ok.Prompt["topic"]);
        Assert.Equal("", (string?)ok.Prompt["register"]);
        Assert.Equal(WritingService.MaxDurationSec, ok.DurationSec);
        Assert.Equal("exam1", ok.ExamId);
    }

    internal static JsonSerializerOptions Web { get; } = new(JsonSerializerDefaults.Web);
}
