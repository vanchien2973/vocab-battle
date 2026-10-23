using Microsoft.Extensions.Logging;

namespace VocabBattle.Api.Core;

public sealed record GateResult(int StatusCode, string Message, int RetryAfterSeconds = 0);

/// <summary>Checks that run before any provider call, and accounting that runs after.</summary>
public sealed class AiGate(AiOptions options, IpRateLimiter limiter, UsageTracker usage, ILogger<AiGate> logger)
{
    /// <summary>Null when the request may call the provider.</summary>
    public GateResult? Check(string ip, string endpoint)
    {
        if (options.ConfigurationError is { } configError)
        {
            logger.LogError("AI is not configured: {Error}", configError);
            return new GateResult(503, "Tính năng AI chưa được cấu hình trên server. Bạn có thể nhập API key riêng trong ⚙️ Cài đặt.");
        }
        if (options.DailyBudgetUsd is { } budget && usage.TodayCost >= budget)
        {
            return new GateResult(429, "Đã hết ngân sách AI của hôm nay. Thử lại vào ngày mai nhé!", 3600);
        }
        var perMinute = endpoint switch
        {
            "chat" => options.ChatPerMinute,
            "lookup" => options.LookupPerMinute,
            _ => options.GeneratePerMinute,
        };
        var decision = limiter.Check(ip, endpoint, perMinute, options.PerIpPerDay);
        return decision.Allowed ? null : new GateResult(429, decision.Message!, decision.RetryAfterSeconds);
    }

    /// <summary>Count tokens and estimated cost for today's usage and log them.</summary>
    /// <param name="priceIn">Per-million-token prices when the call used another model (e.g. grading); default the main prices.</param>
    public decimal Record(string endpoint, string model, AiUsage tokens, decimal? priceIn = null, decimal? priceOut = null)
    {
        var cost = CostCalculator.Estimate(tokens, priceIn ?? options.PriceInputPerMTok, priceOut ?? options.PriceOutputPerMTok);
        usage.Record(endpoint, tokens, cost);
        logger.LogInformation(
            "AI {Endpoint} model={Model} input_tokens={Input} output_tokens={Output} est_cost_usd={Cost}",
            endpoint, model, tokens.InputTokens, tokens.OutputTokens, cost);
        return cost;
    }
}
