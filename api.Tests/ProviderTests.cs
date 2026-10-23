using System.Net;
using VocabBattle.Api.Core;
using static VocabBattle.Api.Tests.Fixtures;

namespace VocabBattle.Api.Tests;

public class OpenAiProviderTests
{
    private static (OpenAiProvider, FakeHandler) Create()
    {
        var handler = new FakeHandler();
        return (new OpenAiProvider(new HttpClient(handler), Options("openai")), handler);
    }

    [Fact]
    public async Task Lookup_sends_structured_output_request_and_parses_text_and_usage()
    {
        var (provider, handler) = Create();
        handler.Reply(HttpStatusCode.OK, $$"""
        {
          "status": "completed",
          "output": [
            { "type": "reasoning", "summary": [] },
            { "type": "message", "content": [{ "type": "output_text", "text": {{Quote(ValidEntry)}} }] }
          ],
          "usage": { "input_tokens": 320, "output_tokens": 210 }
        }
        """);

        var raw = await provider.LookupAsync("resilient", CancellationToken.None);

        Assert.Equal(new AiUsage(320, 210), raw.Usage);
        Assert.Null(LookupService.Validate(raw.Json, out _));
        var (req, _) = handler.Requests.Single();
        Assert.Equal("https://api.openai.com/v1/responses", req.RequestUri!.ToString());
        Assert.Equal("Bearer sk-test", req.Headers.Authorization!.ToString());
        var body = handler.LastBody;
        Assert.Equal("gpt-6-luna", (string?)body["model"]);
        Assert.Equal(1500, (int?)body["max_output_tokens"]);
        Assert.Equal("none", (string?)body["reasoning"]!["effort"]);
        Assert.Equal("json_schema", (string?)body["text"]!["format"]!["type"]);
        Assert.True((bool?)body["text"]!["format"]!["strict"]);
        Assert.NotNull(body["text"]!["format"]!["schema"]!["properties"]!["commonMistakes"]);
        Assert.Equal(AiShared.Prompts.LookupSystem, (string?)body["instructions"]);
        Assert.Null(body["temperature"]);
    }

    [Fact]
    public async Task Lookup_refusal_throws()
    {
        var (provider, handler) = Create();
        handler.Reply(HttpStatusCode.OK, """
        { "output": [{ "type": "message", "content": [{ "type": "refusal", "refusal": "no" }] }], "usage": {} }
        """);
        var e = await Assert.ThrowsAsync<AiProviderException>(() => provider.LookupAsync("x", CancellationToken.None));
        Assert.Equal(422, e.StatusCode);
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, 502)]
    [InlineData(HttpStatusCode.TooManyRequests, 429)]
    [InlineData(HttpStatusCode.InternalServerError, 502)]
    public async Task Http_errors_map_to_friendly_status(HttpStatusCode status, int expected)
    {
        var (provider, handler) = Create();
        handler.Reply(status, """{ "error": { "message": "secret details" } }""");
        var e = await Assert.ThrowsAsync<AiProviderException>(() => provider.LookupAsync("x", CancellationToken.None));
        Assert.Equal(expected, e.StatusCode);
        Assert.DoesNotContain("secret", e.Message);
    }

    [Fact]
    public async Task Http_error_includes_short_provider_code_only()
    {
        var (provider, handler) = Create();
        handler.Reply(HttpStatusCode.Forbidden, """{ "error": { "message": "Project proj_123 lacks access", "code": "model_not_found" } }""");
        var e = await Assert.ThrowsAsync<AiProviderException>(() => provider.LookupAsync("x", CancellationToken.None));
        Assert.Contains("HTTP 403", e.Message);
        Assert.Contains("model_not_found", e.Message);
        Assert.DoesNotContain("proj_123", e.Message);

        handler.Reply(HttpStatusCode.Forbidden, """{ "error": { "code": "<script>alert(1)</script>" } }""");
        var e2 = await Assert.ThrowsAsync<AiProviderException>(() => provider.LookupAsync("x", CancellationToken.None));
        Assert.DoesNotContain("script", e2.Message);
    }

    [Fact]
    public async Task Chat_stream_yields_deltas_then_usage()
    {
        var (provider, handler) = Create();
        handler.ReplySse(
            """event: response.created""" + "\n" + """data: {"type":"response.created","response":{}}""",
            """event: response.output_text.delta""" + "\n" + """data: {"type":"response.output_text.delta","delta":"Hel"}""",
            """event: response.output_text.delta""" + "\n" + """data: {"type":"response.output_text.delta","delta":"lo"}""",
            """event: response.completed""" + "\n" + """data: {"type":"response.completed","response":{"usage":{"input_tokens":50,"output_tokens":7}}}""");

        var events = await Collect(provider.StreamChatAsync("sys", [new("user", "hi")], CancellationToken.None));

        Assert.Equal("Hello", string.Concat(events.OfType<ChatDelta>().Select(d => d.Text)));
        Assert.Equal(new AiUsage(50, 7), events.OfType<ChatCompleted>().Single().Usage);
        var body = handler.LastBody;
        Assert.True((bool?)body["stream"]);
        Assert.Equal("sys", (string?)body["instructions"]);
        Assert.Equal(800, (int?)body["max_output_tokens"]);
        Assert.Equal("user", (string?)body["input"]![0]!["role"]);
    }

    [Fact]
    public async Task Chat_stream_failure_throws()
    {
        var (provider, handler) = Create();
        handler.ReplySse("""data: {"type":"response.failed","response":{"error":{"message":"x"}}}""");
        await Assert.ThrowsAsync<AiProviderException>(() =>
            Collect(provider.StreamChatAsync("sys", [new("user", "hi")], CancellationToken.None)));
    }

    internal static async Task<List<ChatEvent>> Collect(IAsyncEnumerable<ChatEvent> stream)
    {
        var list = new List<ChatEvent>();
        await foreach (var e in stream) list.Add(e);
        return list;
    }
}

public class AnthropicProviderTests
{
    private static (AnthropicProvider, FakeHandler) Create()
    {
        var handler = new FakeHandler();
        return (new AnthropicProvider(new HttpClient(handler), Options("anthropic")), handler);
    }

    [Fact]
    public async Task Lookup_sends_output_config_and_reads_text_blocks_by_type()
    {
        var (provider, handler) = Create();
        handler.Reply(HttpStatusCode.OK, $$"""
        {
          "stop_reason": "end_turn",
          "content": [
            { "type": "thinking", "thinking": "", "signature": "sig" },
            { "type": "text", "text": {{Quote(ValidEntry)}} }
          ],
          "usage": { "input_tokens": 400, "output_tokens": 300 }
        }
        """);

        var raw = await provider.LookupAsync("resilient", CancellationToken.None);

        Assert.Equal(new AiUsage(400, 300), raw.Usage);
        Assert.Null(LookupService.Validate(raw.Json, out _));
        var (req, _) = handler.Requests.Single();
        Assert.Equal("https://api.anthropic.com/v1/messages", req.RequestUri!.ToString());
        Assert.Equal("sk-ant-test", req.Headers.GetValues("x-api-key").Single());
        Assert.Equal(AnthropicProvider.ApiVersion, req.Headers.GetValues("anthropic-version").Single());
        var body = handler.LastBody;
        Assert.Equal("claude-haiku-5-5", (string?)body["model"]);
        Assert.Equal(1500, (int?)body["max_tokens"]);
        Assert.Equal("low", (string?)body["output_config"]!["effort"]);
        Assert.Equal("json_schema", (string?)body["output_config"]!["format"]!["type"]);
        Assert.Equal(AiShared.Prompts.LookupSystem, (string?)body["system"]);
        Assert.Null(body["thinking"]);
        Assert.Null(body["temperature"]);
    }

    [Fact]
    public async Task Lookup_refusal_throws()
    {
        var (provider, handler) = Create();
        handler.Reply(HttpStatusCode.OK, """{ "stop_reason": "refusal", "content": [], "usage": {} }""");
        var e = await Assert.ThrowsAsync<AiProviderException>(() => provider.LookupAsync("x", CancellationToken.None));
        Assert.Equal(422, e.StatusCode);
    }

    [Fact]
    public async Task Chat_stream_skips_thinking_and_sums_usage()
    {
        var (provider, handler) = Create();
        handler.ReplySse(
            "event: message_start\n" + """data: {"type":"message_start","message":{"usage":{"input_tokens":60,"output_tokens":1}}}""",
            "event: content_block_start\n" + """data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}""",
            "event: content_block_delta\n" + """data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"x"}}""",
            "event: content_block_delta\n" + """data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Xin "}}""",
            "event: ping\n" + """data: {"type":"ping"}""",
            "event: content_block_delta\n" + """data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"chào"}}""",
            "event: message_delta\n" + """data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":12}}""",
            "event: message_stop\n" + """data: {"type":"message_stop"}""");

        var events = await OpenAiProviderTests.Collect(provider.StreamChatAsync("sys", [new("user", "hi")], CancellationToken.None));

        Assert.Equal("Xin chào", string.Concat(events.OfType<ChatDelta>().Select(d => d.Text)));
        Assert.Equal(new AiUsage(60, 12), events.OfType<ChatCompleted>().Single().Usage);
        Assert.True((bool?)handler.LastBody["stream"]);
        Assert.Equal(800, (int?)handler.LastBody["max_tokens"]);
    }

    [Fact]
    public async Task Chat_stream_refusal_throws()
    {
        var (provider, handler) = Create();
        handler.ReplySse(
            """data: {"type":"message_start","message":{"usage":{"input_tokens":5}}}""",
            """data: {"type":"message_delta","delta":{"stop_reason":"refusal"},"usage":{"output_tokens":0}}""");
        await Assert.ThrowsAsync<AiProviderException>(() =>
            OpenAiProviderTests.Collect(provider.StreamChatAsync("sys", [new("user", "hi")], CancellationToken.None)));
    }
}
