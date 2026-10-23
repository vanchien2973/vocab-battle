using System.Text.Json;
using System.Text.Json.Nodes;
using Json.Schema;

namespace VocabBattle.Api.Core;

public sealed record StructuredResult(JsonNode Value, AiUsage Usage, int Attempts);

/// <summary>Calls the provider with a schema and validates the reply against the same schema, retrying once.</summary>
public sealed class StructuredService(IAiProvider provider)
{
    public const int MaxAttempts = 2;

    /// <summary>Validate model output with a schema. Returns the error, or null when valid.</summary>
    public static string? Validate(JsonSchema schema, string json, out JsonNode? value)
    {
        value = null;
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
            var result = schema.Evaluate(doc.RootElement, new EvaluationOptions { OutputFormat = OutputFormat.List });
            if (!result.IsValid)
            {
                var detail = result.Details?.FirstOrDefault(d => d.Errors is { Count: > 0 });
                return $"schema mismatch at '{detail?.InstanceLocation}': {detail?.Errors?.Values.FirstOrDefault()}";
            }
            value = JsonNode.Parse(json);
            return null;
        }
    }

    /// <summary>Run one structured call; when the output fails to parse or validate, retry once.</summary>
    public async Task<StructuredResult> RunAsync(string system, string user, string schemaName, int maxTokens, CancellationToken ct)
    {
        var schema = AiShared.Schema(schemaName);
        var request = new StructuredRequest(system, user, schemaName.Replace('-', '_'), AiShared.SchemaNode(schemaName), maxTokens);
        var usage = AiUsage.Zero;
        string? error = null;
        for (var attempt = 1; attempt <= MaxAttempts; attempt++)
        {
            var raw = await provider.GenerateJsonAsync(request, ct);
            usage += raw.Usage;
            error = Validate(schema, raw.Json, out var value);
            if (error is null) return new StructuredResult(value!, usage, attempt);
        }
        throw new StructuredFormatException(error!, usage);
    }
}

/// <summary>Both attempts returned unusable output; carries the tokens spent so they can still be counted.</summary>
public sealed class StructuredFormatException(string detail, AiUsage usage)
    : Exception("AI trả về dữ liệu không hợp lệ, thử lại sau.")
{
    public string Detail { get; } = detail;
    public AiUsage Usage { get; } = usage;
}
