using System.Reflection;
using System.Text.Json;

namespace VocabBattle.Api.Core.Writing;

public sealed record VstepTask(string Kind, string Label, int MinWords, int Minutes);
public sealed record VstepBand(double Min, string Level, string Label);
public sealed record VstepWeights(double Task1, double Task2);
public sealed record VstepOption(string Id, string Label, string? En = null);

/// <summary>
/// VSTEP Writing settings from Shared/vstep.json, the same file the frontend imports (src/vstep/config.ts).
/// Timing, word limits, weights, rounding and levels live only there.
/// </summary>
public sealed record VstepConfig(
    Dictionary<string, VstepTask> Tasks,
    int ExamMinutes,
    int MaxWords,
    int MaxPromptLength,
    int MaxTitleLength,
    VstepWeights WritingWeights,
    double RoundTo,
    List<VstepBand> Bands,
    double ShortEssayCapScale,
    List<string> TargetLevels,
    List<VstepOption> Criteria,
    List<VstepOption> Topics,
    List<VstepOption> EssayTypes,
    List<VstepOption> ErrorCategories,
    List<VstepOption> ErrorRules,
    int MaxErrors,
    int MaxListItems,
    int MaxEvidence,
    int MaxPhrases,
    int MaxAvoid,
    int HistoryLimit)
{
    public static VstepConfig Current { get; } = Load();

    public VstepTask Task(int task) => Tasks[task.ToString()];

    private static VstepConfig Load()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Shared.vstep.json")
            ?? throw new InvalidOperationException("Missing embedded resource Shared.vstep.json");
        return JsonSerializer.Deserialize<VstepConfig>(stream, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
    }
}
