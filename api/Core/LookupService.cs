using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace VocabBattle.Api.Core;

/// <summary>Input the player sent is invalid; the message is shown as-is.</summary>
public sealed class InputException(string message) : Exception(message);

public sealed record LookupResult(JsonNode Entry, AiUsage Usage, int Attempts);

public sealed partial class LookupService(StructuredService structured, AiOptions options)
{
    public const int MaxWordLength = 40;

    [GeneratedRegex(@"^[\p{L}][\p{L}' \-]*$")]
    private static partial Regex WordPattern();

    /// <summary>Trim, collapse spaces, lowercase; null when the input is not a plausible English word or phrase.</summary>
    public static string? NormalizeWord(string? input)
    {
        var word = Regex.Replace(input?.Trim() ?? "", @"\s+", " ").ToLowerInvariant();
        return word.Length is > 0 and <= MaxWordLength && WordPattern().IsMatch(word) ? word : null;
    }

    /// <summary>Validate model output with the lookup schema. Returns the error, or null when valid.</summary>
    public static string? Validate(string json, out JsonNode? entry) =>
        StructuredService.Validate(AiShared.LookupSchema, json, out entry);

    /// <summary>Look up a word; when the output fails to parse or validate, retry once.</summary>
    public async Task<LookupResult> LookupAsync(string? input, CancellationToken ct)
    {
        var word = NormalizeWord(input) ?? throw new InputException($"Từ cần tra phải là chữ cái tiếng Anh, tối đa {MaxWordLength} ký tự.");
        var p = AiShared.Prompts;
        var result = await structured.RunAsync(p.LookupSystem, p.LookupUser.Replace("{word}", word), "lookup", options.LookupMaxTokens, ct);
        return new LookupResult(result.Value, result.Usage, result.Attempts);
    }
}
