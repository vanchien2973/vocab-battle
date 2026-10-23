using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using VocabBattle.Api.Core;

namespace VocabBattle.Api.Tests;

/// <summary>HttpMessageHandler that records requests and replies from a queue.</summary>
public sealed class FakeHandler : HttpMessageHandler
{
    private readonly Queue<Func<HttpResponseMessage>> _responses = new();
    public List<(HttpRequestMessage Request, string Body)> Requests { get; } = [];

    public FakeHandler Reply(HttpStatusCode status, string body, string contentType = "application/json")
    {
        _responses.Enqueue(() => new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, contentType) });
        return this;
    }

    public FakeHandler ReplySse(params string[] events) =>
        Reply(HttpStatusCode.OK, string.Concat(events.Select(e => e + "\n\n")), "text/event-stream");

    public JsonNode LastBody => JsonNode.Parse(Requests[^1].Body)!;

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        Requests.Add((request, request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct)));
        return _responses.Dequeue()();
    }
}

public static class Fixtures
{
    public static AiOptions Options(string provider = "openai") => new()
    {
        Provider = provider,
        Model = provider == "anthropic" ? "claude-haiku-5-5" : "gpt-6-luna",
        OpenAiApiKey = "sk-test",
        AnthropicApiKey = "sk-ant-test",
        PriceInputPerMTok = 0.10m,
        PriceOutputPerMTok = 0.50m,
    };

    public const string ValidEntry = """
    {
      "word": "resilient",
      "itemType": "word",
      "ipa": "/rɪˈzɪliənt/",
      "cefr": "C1",
      "senses": [{ "partOfSpeech": "adjective", "meaningVi": "kiên cường", "definitionEn": "able to recover quickly" }],
      "examples": [{ "en": "Children are often very resilient.", "vi": "Trẻ em thường rất kiên cường." }],
      "collocations": ["resilient economy"],
      "synonyms": ["tough"],
      "antonyms": ["fragile"],
      "commonMistakes": [{ "mistake": "resilience person", "correction": "resilient person", "explanationVi": "Dùng tính từ trước danh từ." }]
    }
    """;

    /// <summary>The request LookupService sends for a word (default 1500 max tokens).</summary>
    public static StructuredRequest LookupRequest(string word) => new(
        AiShared.Prompts.LookupSystem, AiShared.Prompts.LookupUser.Replace("{word}", word), "lookup", AiShared.LookupSchemaNode(), 1500);

    /// <summary>JSON string literal of a value (for embedding JSON text inside a provider response).</summary>
    public static string Quote(string s) => JsonValue.Create(s)!.ToJsonString();
}

/// <summary>Provider that replies with scripted structured outputs and records the requests.</summary>
public sealed class ScriptedProvider(params string[] outputs) : IAiProvider
{
    public int Calls { get; private set; }
    public List<StructuredRequest> Requests { get; } = [];
    public string Name => "fake";
    public string Model => "fake-model";

    public Task<StructuredRaw> GenerateJsonAsync(StructuredRequest request, CancellationToken ct)
    {
        Requests.Add(request);
        return Task.FromResult(new StructuredRaw(outputs[Calls++], new AiUsage(100, 50)));
    }

    public IAsyncEnumerable<ChatEvent> StreamChatAsync(string system, IReadOnlyList<ChatMessage> messages, CancellationToken ct) =>
        throw new NotSupportedException();
}
