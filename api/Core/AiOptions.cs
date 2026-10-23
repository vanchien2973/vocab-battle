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
    /// <summary>generate-deck and extract-items (up to 30 items with examples).</summary>
    public int GenerateMaxTokens { get; init; } = 4000;
    /// <summary>
    /// Off by default: SWA managed functions buffer the whole response (measured 2026-10-23), so SSE brings no benefit.
    /// </summary>
    public bool ChatStreaming { get; init; }
    /// <summary>VSTEP grading model (defaults to <see cref="Model"/>); may be a stronger model than lookups use.</summary>
    public string? GradingModel { get; init; }
    public string? GradingEffort { get; init; }
    /// <summary>Only sent when set: Claude and OpenAI reasoning models reject sampling parameters.</summary>
    public double? GradingTemperature { get; init; }
    public int GradingMaxTokens { get; init; } = 6000;
    /// <summary>Server-side limit for a grading; SWA cuts managed function requests at about 45 s.</summary>
    public int GradingTimeoutSeconds { get; init; } = 38;
    /// <summary>Prices of the grading model; default to the main model's prices.</summary>
    public decimal? GradingPriceInputPerMTok { get; init; }
    public decimal? GradingPriceOutputPerMTok { get; init; }
    /// <summary>Gradings per signed-in user per UTC day.</summary>
    public int WritingGradePerDay { get; init; } = 10;
    /// <summary>Gradings per IP per UTC day when not signed in.</summary>
    public int WritingGradePerDayAnon { get; init; } = 3;
    public decimal? DailyBudgetUsd { get; init; }
    public int LookupPerMinute { get; init; } = 20;
    public int ChatPerMinute { get; init; } = 10;
    /// <summary>generate-deck, suggest-phrases, extract-items, generate-distractors.</summary>
    public int GeneratePerMinute { get; init; } = 10;
    public int PerIpPerDay { get; init; } = 300;
    public string OpenAiBaseUrl { get; init; } = "https://api.openai.com/";
    public string AnthropicBaseUrl { get; init; } = "https://api.anthropic.com/";

    public string EffectiveGradingModel => GradingModel ?? Model ?? "";

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
            GenerateMaxTokens = Int("AI_GENERATE_MAX_TOKENS", d.GenerateMaxTokens),
            ChatStreaming = string.Equals(Str("CHAT_STREAMING"), "true", StringComparison.OrdinalIgnoreCase),
            GradingModel = Str("AI_GRADING_MODEL"),
            GradingEffort = Str("AI_GRADING_EFFORT"),
            GradingTemperature = double.TryParse(Str("AI_GRADING_TEMPERATURE"), NumberStyles.Float, CultureInfo.InvariantCulture, out var temp) ? temp : null,
            GradingMaxTokens = Int("AI_GRADING_MAX_TOKENS", d.GradingMaxTokens),
            GradingTimeoutSeconds = Int("AI_GRADING_TIMEOUT_SECONDS", d.GradingTimeoutSeconds),
            GradingPriceInputPerMTok = Str("AI_GRADING_PRICE_INPUT_PER_MTOK") is null ? null : Dec("AI_GRADING_PRICE_INPUT_PER_MTOK", 0),
            GradingPriceOutputPerMTok = Str("AI_GRADING_PRICE_OUTPUT_PER_MTOK") is null ? null : Dec("AI_GRADING_PRICE_OUTPUT_PER_MTOK", 0),
            WritingGradePerDay = Int("RATE_WRITING_GRADE_PER_DAY", d.WritingGradePerDay),
            WritingGradePerDayAnon = Int("RATE_WRITING_GRADE_PER_DAY_ANON", d.WritingGradePerDayAnon),
            DailyBudgetUsd = Str("AI_DAILY_BUDGET_USD") is null ? null : Dec("AI_DAILY_BUDGET_USD", 0),
            LookupPerMinute = Int("RATE_LOOKUP_PER_MINUTE", d.LookupPerMinute),
            ChatPerMinute = Int("RATE_CHAT_PER_MINUTE", d.ChatPerMinute),
            GeneratePerMinute = Int("RATE_GENERATE_PER_MINUTE", d.GeneratePerMinute),
            PerIpPerDay = Int("RATE_PER_IP_PER_DAY", d.PerIpPerDay),
        };
    }
}
