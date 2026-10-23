using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using Json.Schema;

namespace VocabBattle.Api.Core;

public sealed record Prompts(
    string LookupSystem,
    string LookupUser,
    string ChatBase,
    Dictionary<string, string> ChatModes,
    string ContextTemplate);

/// <summary>System prompts and the lookup schema, embedded from AiShared/*.json (the frontend imports the same files).</summary>
public static class AiShared
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    public static Prompts Prompts { get; } = JsonSerializer.Deserialize<Prompts>(Read("prompts.json"), Web)!;

    public static string LookupSchemaText { get; } = Read("lookup.schema.json");

    public static JsonSchema LookupSchema { get; } = JsonSchema.FromText(LookupSchemaText);

    /// <summary>A fresh copy each time, so callers can embed it in a request body.</summary>
    public static JsonNode LookupSchemaNode() => JsonNode.Parse(LookupSchemaText)!;

    private static string Read(string name)
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream($"AiShared.{name}")
            ?? throw new InvalidOperationException($"Missing embedded resource AiShared.{name}");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}
