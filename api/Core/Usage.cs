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

/// <summary>Cosmos DB request units spent today, per operation (e.g. "decks.read").</summary>
public sealed record RuTotals(int Requests, double RequestUnits)
{
    public static readonly RuTotals Empty = new(0, 0);
    public RuTotals Add(double ru) => new(Requests + 1, Math.Round(RequestUnits + ru, 2));
}

public sealed record RuSnapshot(RuTotals Total, IReadOnlyDictionary<string, RuTotals> ByOperation);

public sealed record UsageSnapshot(
    string DateUtc, UsageTotals Total, IReadOnlyDictionary<string, UsageTotals> ByEndpoint, RuSnapshot Ru, string Note);

/// <summary>
/// Today's AI usage, in memory. Resets on cold start and is per instance: with several instances each one
/// reports (and budgets) only its own traffic.
/// </summary>
public sealed class UsageTracker(TimeProvider time)
{
    private readonly Lock _gate = new();
    private DateOnly _day = DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime);
    private readonly Dictionary<string, UsageTotals> _byEndpoint = [];
    private readonly Dictionary<string, RuTotals> _ru = [];

    public void Record(string endpoint, AiUsage usage, decimal cost)
    {
        lock (_gate)
        {
            Roll();
            _byEndpoint[endpoint] = _byEndpoint.GetValueOrDefault(endpoint, UsageTotals.Empty).Add(usage, cost);
        }
    }

    public void RecordRu(string operation, double requestUnits)
    {
        lock (_gate)
        {
            Roll();
            _ru[operation] = _ru.GetValueOrDefault(operation, RuTotals.Empty).Add(requestUnits);
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
            var ru = _ru.Values.Aggregate(RuTotals.Empty, (a, b) => new(a.Requests + b.Requests, Math.Round(a.RequestUnits + b.RequestUnits, 2)));
            return new UsageSnapshot(_day.ToString("yyyy-MM-dd"), total, new Dictionary<string, UsageTotals>(_byEndpoint),
                new RuSnapshot(ru, new Dictionary<string, RuTotals>(_ru)), "In-memory per instance; resets on restart.");
        }
    }

    private void Roll()
    {
        var today = DateOnly.FromDateTime(time.GetUtcNow().UtcDateTime);
        if (today == _day) return;
        _day = today;
        _byEndpoint.Clear();
        _ru.Clear();
    }
}
