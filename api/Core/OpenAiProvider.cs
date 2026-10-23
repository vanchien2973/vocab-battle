using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json.Nodes;

namespace VocabBattle.Api.Core;

/// <summary>OpenAI Responses API (POST /v1/responses) with Structured Outputs and SSE streaming.</summary>
public sealed class OpenAiProvider(HttpClient http, AiOptions options) : IAiProvider
{
    public string Name => "OpenAI";
    public string Model => options.Model!;
    private string Effort => options.Effort ?? "none";

    public async Task<LookupRaw> LookupAsync(string word, CancellationToken ct)
    {
        var body = new JsonObject
        {
            ["model"] = Model,
            ["instructions"] = AiShared.Prompts.LookupSystem,
            ["input"] = new JsonArray(Message("user", AiShared.Prompts.LookupUser.Replace("{word}", word))),
            ["max_output_tokens"] = options.LookupMaxTokens,
            ["reasoning"] = new JsonObject { ["effort"] = Effort },
            ["text"] = new JsonObject
            {
                ["format"] = new JsonObject
                {
                    ["type"] = "json_schema",
                    ["name"] = "dictionary_entry",
                    ["strict"] = true,
                    ["schema"] = AiShared.LookupSchemaNode(),
                },
            },
            ["store"] = false,
        };

        using var res = await SendAsync(body, ct);
        var doc = JsonNode.Parse(await res.Content.ReadAsStringAsync(ct));
        var usage = ReadUsage(doc?["usage"]);
        var text = new StringBuilder();
        foreach (var item in doc?["output"]?.AsArray() ?? [])
        {
            if ((string?)item?["type"] != "message") continue;
            foreach (var part in item!["content"]?.AsArray() ?? [])
            {
                switch ((string?)part?["type"])
                {
                    case "output_text":
                        text.Append((string?)part!["text"]);
                        break;
                    case "refusal":
                        throw new AiProviderException("AI từ chối tra từ này.", 422);
                }
            }
        }
        // An "incomplete" response (e.g. max_output_tokens) yields truncated JSON; LookupService retries on invalid JSON.
        return new LookupRaw(text.ToString(), usage);
    }

    public async IAsyncEnumerable<ChatEvent> StreamChatAsync(
        string system, IReadOnlyList<ChatMessage> messages, [EnumeratorCancellation] CancellationToken ct)
    {
        var input = new JsonArray();
        foreach (var m in messages) input.Add(Message(m.Role, m.Content));
        var body = new JsonObject
        {
            ["model"] = Model,
            ["instructions"] = system,
            ["input"] = input,
            ["max_output_tokens"] = options.ChatMaxTokens,
            ["reasoning"] = new JsonObject { ["effort"] = Effort },
            ["stream"] = true,
            ["store"] = false,
        };

        using var res = await SendAsync(body, ct);
        await using var stream = await res.Content.ReadAsStreamAsync(ct);
        await foreach (var evt in Sse.ReadAsync(stream, ct))
        {
            if (evt.Data == "[DONE]") yield break;
            var data = JsonNode.Parse(evt.Data);
            switch ((string?)data?["type"] ?? evt.Event)
            {
                case "response.output_text.delta":
                    yield return new ChatDelta((string?)data!["delta"] ?? "");
                    break;
                case "response.refusal.delta":
                    yield return new ChatDelta((string?)data!["delta"] ?? "");
                    break;
                case "response.completed":
                case "response.incomplete":
                    yield return new ChatCompleted(ReadUsage(data!["response"]?["usage"]));
                    yield break;
                case "response.failed":
                case "error":
                    throw new AiProviderException("OpenAI gặp lỗi khi trả lời, thử lại sau.");
            }
        }
    }

    private static JsonObject Message(string role, string content) => new() { ["role"] = role, ["content"] = content };

    internal static AiUsage ReadUsage(JsonNode? usage) =>
        new((int?)usage?["input_tokens"] ?? 0, (int?)usage?["output_tokens"] ?? 0);

    private async Task<HttpResponseMessage> SendAsync(JsonObject body, CancellationToken ct)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(options.OpenAiBaseUrl), "v1/responses"))
        {
            Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json"),
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", options.OpenAiApiKey);
        var res = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!res.IsSuccessStatusCode)
        {
            var status = (int)res.StatusCode;
            res.Dispose();
            throw AiProviderFactory.HttpError(Name, status);
        }
        return res;
    }
}
