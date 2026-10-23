namespace VocabBattle.Api.Core;

public static class CostCalculator
{
    /// <summary>Estimated USD cost from per-million-token prices set in configuration.</summary>
    public static decimal Estimate(AiUsage usage, decimal inputPerMTok, decimal outputPerMTok) =>
        Math.Round(usage.InputTokens * inputPerMTok / 1_000_000m + usage.OutputTokens * outputPerMTok / 1_000_000m, 8);
}

public sealed record UsageTotals(int Requests, long InputTokens, long OutputTokens, decimal EstimatedCostUsd)
{
    public static readonly UsageTotals Empty = new(0, 0, 0, 0);
    public UsageTotals Add(AiUsage u, decimal cost) =>
        new(Requests + 1, InputTokens + u.InputTokens, OutputTokens + u.OutputTokens, EstimatedCostUsd + cost);
}

public sealed record UsageSnapshot(string DateUtc, UsageTotals Total, IReadOnlyDictionary<string, UsageTotals> ByEndpoint, string Note);

/// <summary>
/// Today's AI usage, in memory. Resets on cold start and is per instance: with several instances each one
/// reports (and budgets) only its own traffic.
/// </summary>
public sealed class UsageTracker(TimeProvider time)
{
    private readonly Lock _gate = new();
    private DateOnly _day = DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime);
    private readonly Dictionary<string, UsageTotals> _byEndpoint = [];

    public void Record(string endpoint, AiUsage usage, decimal cost)
    {
        lock (_gate)
        {
            Roll();
            _byEndpoint[endpoint] = _byEndpoint.GetValueOrDefault(endpoint, UsageTotals.Empty).Add(usage, cost);
        }
    }

    public decimal TodayCost
    {
        get
        {
            lock (_gate)
            {
                Roll();
                return _byEndpoint.Values.Sum(t => t.EstimatedCostUsd);
            }
        }
    }

    public UsageSnapshot Snapshot()
    {
        lock (_gate)
        {
            Roll();
            var total = _byEndpoint.Values.Aggregate(UsageTotals.Empty, (a, b) => new(
                a.Requests + b.Requests, a.InputTokens + b.InputTokens, a.OutputTokens + b.OutputTokens, a.EstimatedCostUsd + b.EstimatedCostUsd));
            return new UsageSnapshot(_day.ToString("yyyy-MM-dd"), total, new Dictionary<string, UsageTotals>(_byEndpoint),
                "In-memory per instance; resets on restart.");
        }
    }

    private void Roll()
    {
        var today = DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime);
        if (today == _day) return;
        _day = today;
        _byEndpoint.Clear();
    }
}
