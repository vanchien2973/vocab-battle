namespace VocabBattle.Api.Core;

public sealed record AiUsage(int InputTokens, int OutputTokens)
{
    public static readonly AiUsage Zero = new(0, 0);
    public static AiUsage operator +(AiUsage a, AiUsage b) => new(a.InputTokens + b.InputTokens, a.OutputTokens + b.OutputTokens);
}

public sealed record ChatMessage(string Role, string Content);

/// <summary>Raw structured-output text from the provider; validated by <see cref="LookupService"/>.</summary>
public sealed record LookupRaw(string Json, AiUsage Usage);

public abstract record ChatEvent;
public sealed record ChatDelta(string Text) : ChatEvent;
public sealed record ChatCompleted(AiUsage Usage) : ChatEvent;

/// <summary>Provider failure with a message safe to show to players.</summary>
public sealed class AiProviderException(string message, int statusCode = 502) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}

public interface IAiProvider
{
    string Name { get; }
    string Model { get; }
    Task<LookupRaw> LookupAsync(string word, CancellationToken ct);
    IAsyncEnumerable<ChatEvent> StreamChatAsync(string system, IReadOnlyList<ChatMessage> messages, CancellationToken ct);
}

public static class AiProviderFactory
{
    public static IAiProvider Create(AiOptions options, HttpClient http) => options.Provider switch
    {
        "anthropic" => new AnthropicProvider(http, options),
        _ => new OpenAiProvider(http, options),
    };

    /// <summary>Map a provider HTTP error to a message for players (never echo the provider body, it may contain request details).</summary>
    internal static AiProviderException HttpError(string provider, int status) => status switch
    {
        401 or 403 => new($"API key của {provider} không hợp lệ hoặc không có quyền.", 502),
        429 => new($"{provider} đang giới hạn tần suất, thử lại sau ít phút.", 429),
        >= 500 => new($"{provider} đang gặp sự cố, thử lại sau.", 502),
        _ => new($"{provider} từ chối yêu cầu (HTTP {status}).", 502),
    };
}
