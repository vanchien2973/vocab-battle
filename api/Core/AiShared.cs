using System.Collections.Concurrent;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using Json.Schema;

namespace VocabBattle.Api.Core;

public sealed record TaskPrompt(string System, string User);

public sealed record Prompts(
    string LookupSystem,
    string LookupUser,
    string ChatBase,
    Dictionary<string, string> ChatModes,
    string ContextTemplate,
    Dictionary<string, TaskPrompt> Tasks);

/// <summary>Limits shared with the frontend (Shared/limits.json).</summary>
public sealed record FieldLimits(
    int DeckName, int DeckDescription, int Id, int Text, int Meaning, int Example, int Ipa, int PartOfSpeech, int Note, int Tag);

public sealed record CountRange(int MinCount, int MaxCount, int MaxTopicLength);

public sealed record ExtractLimits(int MaxPassageLength);

public sealed record Limits(
    int MaxDecksPerUser,
    int MaxItemsPerDeck,
    int MaxExamplesPerItem,
    int MaxTagsPerItem,
    int MaxDistractorsPerList,
    FieldLimits FieldLength,
    CountRange GenerateDeck,
    ExtractLimits ExtractItems,
    int ShareCodeLength,
    int ShareTtlSeconds);

/// <summary>System prompts, schemas and limits, embedded from AiShared/*.json and Shared/*.json (the frontend imports the same files).</summary>
public static class AiShared
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);
    private static readonly ConcurrentDictionary<string, (string Text, JsonSchema Schema)> Schemas = new();

    public static Prompts Prompts { get; } = JsonSerializer.Deserialize<Prompts>(Read("AiShared.prompts.json"), Web)!;

    public static Limits Limits { get; } = JsonSerializer.Deserialize<Limits>(Read("Shared.limits.json"), Web)!;

    public static JsonSchema LookupSchema => Schema("lookup");

    /// <summary>A fresh copy each time, so callers can embed it in a request body.</summary>
    public static JsonNode LookupSchemaNode() => SchemaNode("lookup");

    /// <summary>Compiled schema from AiShared/{name}.schema.json.</summary>
    public static JsonSchema Schema(string name) => Load(name).Schema;

    public static JsonNode SchemaNode(string name) => JsonNode.Parse(Load(name).Text)!;

    private static (string Text, JsonSchema Schema) Load(string name) => Schemas.GetOrAdd(name, n =>
    {
        var text = Read($"AiShared.{n}.schema.json");
        return (text, JsonSchema.FromText(text));
    });

    private static string Read(string name)
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name)
            ?? throw new InvalidOperationException($"Missing embedded resource {name}");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}
