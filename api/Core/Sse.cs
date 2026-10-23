using System.Runtime.CompilerServices;
using System.Text;

namespace VocabBattle.Api.Core;

public sealed record SseEvent(string? Event, string Data);

/// <summary>Minimal Server-Sent Events reader for provider streams.</summary>
public static class Sse
{
    public static async IAsyncEnumerable<SseEvent> ReadAsync(Stream stream, [EnumeratorCancellation] CancellationToken ct)
    {
        using var reader = new StreamReader(stream, Encoding.UTF8);
        string? evt = null;
        var data = new StringBuilder();
        while (await reader.ReadLineAsync(ct) is { } line)
        {
            if (line.Length == 0)
            {
                if (data.Length > 0) yield return new SseEvent(evt, data.ToString());
                evt = null;
                data.Clear();
            }
            else if (line.StartsWith("event:", StringComparison.Ordinal))
            {
                evt = line[6..].Trim();
            }
            else if (line.StartsWith("data:", StringComparison.Ordinal))
            {
                if (data.Length > 0) data.Append('\n');
                data.Append(line[5..].TrimStart());
            }
        }
        if (data.Length > 0) yield return new SseEvent(evt, data.ToString());
    }
}
