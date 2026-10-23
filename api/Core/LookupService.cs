using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Json.Schema;

namespace VocabBattle.Api.Core;

/// <summary>Input the player sent is invalid; the message is shown as-is.</summary>
public sealed class InputException(string message) : Exception(message);

public sealed record LookupResult(JsonNode Entry, AiUsage Usage, int Attempts);

public sealed partial class LookupService(IAiProvider provider)
{
    public const int MaxWordLength = 40;
    public const int MaxAttempts = 2;

    [GeneratedRegex(@"^[\p{L}][\p{L}' \-]*$")]
    private static partial Regex WordPattern();

    /// <summary>Trim, collapse spaces, lowercase; null when the input is not a plausible English word or phrase.</summary>
    public static string? NormalizeWord(string? input)
    {
        var word = Regex.Replace(input?.Trim() ?? "", @"\s+", " ").ToLowerInvariant();
        return word.Length is > 0 and <= MaxWordLength && WordPattern().IsMatch(word) ? word : null;
    }

    /// <summary>Validate model output with the same schema sent to the provider. Returns the error, or null when valid.</summary>
    public static string? Validate(string json, out JsonNode? entry)
    {
        entry = null;
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(json);
        }
        catch (JsonException e)
        {
            return $"invalid JSON: {e.Message}";
        }
        using (doc)
        {
            var result = AiShared.LookupSchema.Evaluate(doc.RootElement, new EvaluationOptions { OutputFormat = OutputFormat.List });
            if (!result.IsValid)
            {
                var detail = result.Details?.FirstOrDefault(d => d.Errors is { Count: > 0 });
                return $"schema mismatch at '{detail?.InstanceLocation}': {detail?.Errors?.Values.FirstOrDefault()}";
            }
            entry = JsonNode.Parse(json);
            return null;
        }
    }

    /// <summary>Look up a word; when the output fails to parse or validate, retry once.</summary>
    public async Task<LookupResult> LookupAsync(string? input, CancellationToken ct)
    {
        var word = NormalizeWord(input) ?? throw new InputException($"Từ cần tra phải là chữ cái tiếng Anh, tối đa {MaxWordLength} ký tự.");
        var usage = AiUsage.Zero;
        string? error = null;
        for (var attempt = 1; attempt <= MaxAttempts; attempt++)
        {
            var raw = await provider.LookupAsync(word, ct);
            usage += raw.Usage;
            error = Validate(raw.Json, out var entry);
            if (error is null) return new LookupResult(entry!, usage, attempt);
        }
        throw new LookupFormatException(error!, usage);
    }
}

/// <summary>Both attempts returned unusable output; carries the tokens spent so they can still be counted.</summary>
public sealed class LookupFormatException(string detail, AiUsage usage)
    : Exception("AI trả về dữ liệu không hợp lệ, thử lại sau.")
{
    public string Detail { get; } = detail;
    public AiUsage Usage { get; } = usage;
}
