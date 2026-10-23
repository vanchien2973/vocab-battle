namespace VocabBattle.Api.Core.Writing;

/// <summary>Score formulas (same as src/vstep/scoring.ts); all numbers come from <see cref="VstepConfig"/>.</summary>
public static class WritingScoring
{
    public static readonly string[] Criteria = ["taskFulfilment", "organization", "vocabulary", "grammar"];

    private static VstepConfig C => VstepConfig.Current;

    public static double Round(double x) => Math.Round(x / C.RoundTo, MidpointRounding.AwayFromZero) * C.RoundTo;

    public static double Clamp(double x) => double.IsFinite(x) ? Round(Math.Clamp(x, 0, 10)) : 0;

    /// <summary>Task score: mean of the four criteria, rounded to 0.5.</summary>
    public static double TaskScore(IEnumerable<double> criteria) => Round(criteria.Average());

    /// <summary>Writing score of a full test: (Task 1 + Task 2 × 2) / 3, rounded to 0.5.</summary>
    public static double WritingScore(double task1, double task2) =>
        Round((task1 * C.WritingWeights.Task1 + task2 * C.WritingWeights.Task2) / (C.WritingWeights.Task1 + C.WritingWeights.Task2));

    public static string Band(double score) => C.Bands.FirstOrDefault(b => score >= b.Min)?.Level ?? "none";

    /// <summary>Highest task-fulfilment score below the minimum length (proportional to the length).</summary>
    public static double ShortEssayCap(int words, int minWords) => Round(C.ShortEssayCapScale * Math.Max(0, words) / minWords);
}
