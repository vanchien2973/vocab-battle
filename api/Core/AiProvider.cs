using System.Text.Json.Nodes;

namespace VocabBattle.Api.Core;

public sealed record AiUsage(int InputTokens, int OutputTokens)
{
    public static readonly AiUsage Zero = new(0, 0);
    public static AiUsage operator +(AiUsage a, AiUsage b) => new(a.InputTokens + b.InputTokens, a.OutputTokens + b.OutputTokens);
}

public sealed record ChatMessage(string Role, string Content);

/// <summary>One structured-output call: fixed server-side prompts and a JSON schema the reply must match.</summary>
public sealed record StructuredRequest(string System, string User, string SchemaName, JsonNode Schema, int MaxTokens);

/// <summary>Raw structured-output text from the provider; validated by <see cref="StructuredService"/>.</summary>
public sealed record StructuredRaw(string Json, AiUsage Usage);

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
    Task<StructuredRaw> GenerateJsonAsync(StructuredRequest request, CancellationToken ct);
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
    internal static AiProviderException HttpError(string provider, int status, string? errorCode = null)
    {
        var e = HttpErrorCore(provider, status);
        // Only a short identifier (e.g. "model_not_found"), never the provider's free-text message.
        return errorCode is { Length: > 0 and <= 64 } && System.Text.RegularExpressions.Regex.IsMatch(errorCode, "^[a-z0-9_.-]+$")
            ? new AiProviderException($"{e.Message} Mã lỗi: {errorCode}.", e.StatusCode)
            : e;
    }

    /// <summary>Short error identifier from a provider error body: OpenAI error.code/type, Anthropic error.type.</summary>
    internal static async Task<string?> ReadErrorCodeAsync(HttpResponseMessage res, CancellationToken ct)
    {
        try
        {
            var err = System.Text.Json.Nodes.JsonNode.Parse(await res.Content.ReadAsStringAsync(ct))?["error"];
            return (string?)err?["code"] ?? (string?)err?["type"];
        }
        catch (Exception)
        {
            return null;
        }
    }

    private static AiProviderException HttpErrorCore(string provider, int status) => status switch
    {
        401 => new($"API key của {provider} không hợp lệ (HTTP 401). Kiểm tra lại key trong Application settings.", 502),
        403 => new($"API key của {provider} không có quyền dùng model hoặc endpoint này (HTTP 403).", 502),
        404 => new($"{provider} không tìm thấy model đã cấu hình (HTTP 404). Kiểm tra AI_MODEL.", 502),
        429 => new($"{provider} đang giới hạn tần suất, thử lại sau ít phút.", 429),
        >= 500 => new($"{provider} đang gặp sự cố, thử lại sau.", 502),
        _ => new($"{provider} từ chối yêu cầu (HTTP {status}).", 502),
    };
}
