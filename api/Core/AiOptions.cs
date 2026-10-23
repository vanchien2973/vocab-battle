using System.Globalization;

namespace VocabBattle.Api.Core;

/// <summary>All AI settings come from SWA Application settings (environment variables); nothing is hardcoded.</summary>
public sealed record AiOptions
{
    public string Provider { get; init; } = "openai";
    public string? Model { get; init; }
    public string? OpenAiApiKey { get; init; }
    public string? AnthropicApiKey { get; init; }
    /// <summary>Provider-specific reasoning effort. Defaults: OpenAI "none", Anthropic "low".</summary>
    public string? Effort { get; init; }
    public decimal PriceInputPerMTok { get; init; }
    public decimal PriceOutputPerMTok { get; init; }
    public int LookupMaxTokens { get; init; } = 1500;
    public int ChatMaxTokens { get; init; } = 800;
    /// <summary>
    /// Off by default: SWA managed functions buffer the whole response (measured 2026-10-23), so SSE brings no benefit.
    /// </summary>
    public bool ChatStreaming { get; init; }
    public decimal? DailyBudgetUsd { get; init; }
    public int LookupPerMinute { get; init; } = 20;
    public int ChatPerMinute { get; init; } = 10;
    public int PerIpPerDay { get; init; } = 300;
    public string OpenAiBaseUrl { get; init; } = "https://api.openai.com/";
    public string AnthropicBaseUrl { get; init; } = "https://api.anthropic.com/";

    public string ApiKey => Provider == "anthropic" ? AnthropicApiKey ?? "" : OpenAiApiKey ?? "";

    /// <summary>Why the API cannot call the provider, or null when configured.</summary>
    public string? ConfigurationError =>
        Provider is not ("openai" or "anthropic") ? $"AI_PROVIDER '{Provider}' không hợp lệ (openai | anthropic)."
        : string.IsNullOrWhiteSpace(Model) ? "Chưa cấu hình AI_MODEL."
        : string.IsNullOrWhiteSpace(ApiKey) ? $"Chưa cấu hình API key cho {Provider}."
        : null;

    public static AiOptions FromEnvironment() => From(Environment.GetEnvironmentVariable);

    public static AiOptions From(Func<string, string?> get)
    {
        string? Str(string key) => string.IsNullOrWhiteSpace(get(key)) ? null : get(key)!.Trim();
        decimal Dec(string key, decimal fallback) =>
            decimal.TryParse(Str(key), NumberStyles.Number, CultureInfo.InvariantCulture, out var v) ? v : fallback;
        int Int(string key, int fallback) => int.TryParse(Str(key), out var v) && v > 0 ? v : fallback;

        var d = new AiOptions();
        return new AiOptions
        {
            Provider = (Str("AI_PROVIDER") ?? d.Provider).ToLowerInvariant(),
            Model = Str("AI_MODEL"),
            OpenAiApiKey = Str("OPENAI_API_KEY"),
            AnthropicApiKey = Str("ANTHROPIC_API_KEY"),
            Effort = Str("AI_EFFORT"),
            PriceInputPerMTok = Dec("AI_PRICE_INPUT_PER_MTOK", 0),
            PriceOutputPerMTok = Dec("AI_PRICE_OUTPUT_PER_MTOK", 0),
            LookupMaxTokens = Int("AI_LOOKUP_MAX_TOKENS", d.LookupMaxTokens),
            ChatMaxTokens = Int("AI_CHAT_MAX_TOKENS", d.ChatMaxTokens),
            ChatStreaming = string.Equals(Str("CHAT_STREAMING"), "true", StringComparison.OrdinalIgnoreCase),
            DailyBudgetUsd = Str("AI_DAILY_BUDGET_USD") is null ? null : Dec("AI_DAILY_BUDGET_USD", 0),
            LookupPerMinute = Int("RATE_LOOKUP_PER_MINUTE", d.LookupPerMinute),
            ChatPerMinute = Int("RATE_CHAT_PER_MINUTE", d.ChatPerMinute),
            PerIpPerDay = Int("RATE_PER_IP_PER_DAY", d.PerIpPerDay),
        };
    }
}
