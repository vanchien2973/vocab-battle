using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json.Nodes;

namespace VocabBattle.Api.Core;

/// <summary>
/// Claude Messages API (POST /v1/messages) with structured outputs (<c>output_config.format</c>) and SSE streaming.
/// Raw HTTP so the HttpClient can be mocked in tests. No <c>thinking</c>/<c>temperature</c> is sent: current models
/// think adaptively by default and reject sampling parameters; <c>output_config.effort</c> keeps token use low.
/// </summary>
public sealed class AnthropicProvider(HttpClient http, AiOptions options) : IAiProvider
{
    public const string ApiVersion = "2026-10-21";

    public string Name => "Anthropic";
    public string Model => options.Model!;
    private string Effort => options.Effort ?? "low";

    public async Task<StructuredRaw> GenerateJsonAsync(StructuredRequest request, CancellationToken ct)
    {
        var body = new JsonObject
        {
            ["model"] = request.Model ?? Model,
            ["max_tokens"] = request.MaxTokens,
            ["system"] = request.System,
            ["messages"] = new JsonArray(Message("user", request.User)),
            ["output_config"] = new JsonObject
            {
                ["effort"] = request.Effort ?? Effort,
                ["format"] = new JsonObject { ["type"] = "json_schema", ["schema"] = request.Schema.DeepClone() },
            },
        };
        if (request.Temperature is { } temperature) body["temperature"] = temperature;

        using var res = await SendAsync(body, ct);
        var doc = JsonNode.Parse(await res.Content.ReadAsStringAsync(ct));
        if ((string?)doc?["stop_reason"] == "refusal") throw new AiProviderException("AI từ chối yêu cầu này.", 422);
        // Read blocks by type: responses may start with (empty) thinking blocks.
        var text = new StringBuilder();
        foreach (var block in doc?["content"]?.AsArray() ?? [])
        {
            if ((string?)block?["type"] == "text") text.Append((string?)block!["text"]);
        }
        return new StructuredRaw(text.ToString(), ReadUsage(doc?["usage"]));
    }

    public async IAsyncEnumerable<ChatEvent> StreamChatAsync(
        string system, IReadOnlyList<ChatMessage> messages, [EnumeratorCancellation] CancellationToken ct)
    {
        var msgs = new JsonArray();
        foreach (var m in messages) msgs.Add(Message(m.Role, m.Content));
        var body = new JsonObject
        {
            ["model"] = Model,
            ["max_tokens"] = options.ChatMaxTokens,
            ["system"] = system,
            ["messages"] = msgs,
            ["output_config"] = new JsonObject { ["effort"] = Effort },
            ["stream"] = true,
        };

        using var res = await SendAsync(body, ct);
        await using var stream = await res.Content.ReadAsStreamAsync(ct);
        var input = 0;
        var output = 0;
        await foreach (var evt in Sse.ReadAsync(stream, ct))
        {
            var data = JsonNode.Parse(evt.Data);
            switch ((string?)data?["type"] ?? evt.Event)
            {
                case "message_start":
                    input = (int?)data!["message"]?["usage"]?["input_tokens"] ?? 0;
                    break;
                case "content_block_delta":
                    // Only text deltas; thinking/signature deltas are not shown.
                    var delta = data!["delta"];
                    if ((string?)delta?["type"] == "text_delta") yield return new ChatDelta((string?)delta!["text"] ?? "");
                    break;
                case "message_delta":
                    output = (int?)data!["usage"]?["output_tokens"] ?? output;
                    if ((string?)data["delta"]?["stop_reason"] == "refusal")
                        throw new AiProviderException("AI từ chối trả lời yêu cầu này.", 422);
                    break;
                case "message_stop":
                    yield return new ChatCompleted(new AiUsage(input, output));
                    yield break;
                case "error":
                    throw new AiProviderException("Claude gặp lỗi khi trả lời, thử lại sau.");
            }
        }
    }

    private static JsonObject Message(string role, string content) => new() { ["role"] = role, ["content"] = content };

    internal static AiUsage ReadUsage(JsonNode? usage) =>
        new((int?)usage?["input_tokens"] ?? 0, (int?)usage?["output_tokens"] ?? 0);

    private async Task<HttpResponseMessage> SendAsync(JsonObject body, CancellationToken ct)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(options.AnthropicBaseUrl), "v1/messages"))
        {
            Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json"),
        };
        req.Headers.Add("x-api-key", options.AnthropicApiKey);
        req.Headers.Add("anthropic-version", ApiVersion);
        var res = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!res.IsSuccessStatusCode)
        {
            var status = (int)res.StatusCode;
            var code = await AiProviderFactory.ReadErrorCodeAsync(res, ct);
            res.Dispose();
            throw AiProviderFactory.HttpError(Name, status, code);
        }
        return res;
    }
}
