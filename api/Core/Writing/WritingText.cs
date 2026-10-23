using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace VocabBattle.Api.Core.Writing;

public static partial class WritingText
{
    [GeneratedRegex(@"\s+")]
    private static partial Regex Spaces();

    /// <summary>
    /// Same rule as countWords in src/vstep/wordCount.ts: split on whitespace and en/em dashes, count tokens
    /// that contain a letter or digit ("well-known", "don't", "2,000" are one word; "-" and "..." none).
    /// </summary>
    public static int CountWords(string? text)
    {
        if (string.IsNullOrEmpty(text)) return 0;
        var n = 0;
        foreach (var token in Spaces().Split(text.Replace('–', ' ').Replace('—', ' ')))
        {
            if (token.Any(char.IsLetterOrDigit)) n++;
        }
        return n;
    }

    public static string NormalizeSpace(string s) => Spaces().Replace(s, " ").Trim();

    /// <summary>First 16 hex chars of SHA-256 of the whitespace-normalized prompt (same as promptIdOf in the frontend).</summary>
    public static string PromptId(string promptText) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(NormalizeSpace(promptText))))[..16];

    /// <summary>Fill {name} placeholders in one pass so player text can never inject another placeholder.</summary>
    public static string Fill(string template, IReadOnlyDictionary<string, string> values) =>
        PlaceholderRegex().Replace(template, m => values.TryGetValue(m.Groups[1].Value, out var v) ? v : m.Value);

    [GeneratedRegex(@"\{(\w+)\}")]
    private static partial Regex PlaceholderRegex();
}
