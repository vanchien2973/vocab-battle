using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using VocabBattle.Api.Core;

namespace VocabBattle.Api.Functions;

/// <summary>HTTP triggers only parse, gate and serialize; the logic lives in Core.</summary>
public sealed class AiFunctions(
    AiOptions options, AiGate gate, IAiProvider provider, LookupService lookup, AiTasksService tasks, UsageTracker usage,
    ILogger<AiFunctions> logger)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public sealed record LookupBody(string? Word);

    [Function("lookup")]
    public async Task<IActionResult> Lookup(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "lookup")] HttpRequest req, CancellationToken ct)
    {
        if (await ReadAsync<LookupBody>(req, ct) is not { } body) return Error(400, "Yêu cầu không hợp lệ.");
        if (LookupService.NormalizeWord(body.Word) is null)
            return Error(400, $"Từ cần tra phải là chữ cái tiếng Anh, tối đa {LookupService.MaxWordLength} ký tự.");
        if (Gate(req, "lookup") is { } blocked) return blocked;

        try
        {
            var result = await lookup.LookupAsync(body.Word, ct);
            gate.Record("lookup", provider.Model, result.Usage);
            return new OkObjectResult(result.Entry);
        }
        catch (StructuredFormatException e)
        {
            gate.Record("lookup", provider.Model, e.Usage);
            logger.LogWarning("Lookup output invalid after retry: {Detail}", e.Detail);
            return Error(502, e.Message);
        }
        catch (AiProviderException e)
        {
            return Error(e.StatusCode, e.Message);
        }
    }

    [Function("generate-deck")]
    public Task<IActionResult> GenerateDeck(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "generate-deck")] HttpRequest req, CancellationToken ct) =>
        RunTaskAsync<GenerateDeckInput>(req, "generate-deck", tasks.GenerateDeckAsync, ct);

    [Function("suggest-phrases")]
    public Task<IActionResult> SuggestPhrases(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "suggest-phrases")] HttpRequest req, CancellationToken ct) =>
        RunTaskAsync<SuggestPhrasesInput>(req, "suggest-phrases", tasks.SuggestPhrasesAsync, ct);

    [Function("extract-items")]
    public Task<IActionResult> ExtractItems(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "extract-items")] HttpRequest req, CancellationToken ct) =>
        RunTaskAsync<ExtractItemsInput>(req, "extract-items", tasks.ExtractItemsAsync, ct);

    [Function("generate-distractors")]
    public Task<IActionResult> GenerateDistractors(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "generate-distractors")] HttpRequest req, CancellationToken ct) =>
        RunTaskAsync<DistractorsInput>(req, "generate-distractors", tasks.GenerateDistractorsAsync, ct);

    /// <summary>Parse, gate (rate limit + budget), run the task, count tokens; input errors never reach the provider.</summary>
    private async Task<IActionResult> RunTaskAsync<T>(
        HttpRequest req, string endpoint, Func<T?, CancellationToken, Task<AiTaskResult>> run, CancellationToken ct) where T : class
    {
        if (await ReadAsync<T>(req, ct) is not { } body) return Error(400, "Yêu cầu không hợp lệ.");
        try
        {
            AiTasksService.Precheck(body);
        }
        catch (InputException e)
        {
            return Error(400, e.Message);
        }
        if (Gate(req, endpoint) is { } blocked) return blocked;
        try
        {
            var result = await run(body, ct);
            gate.Record(endpoint, provider.Model, result.Usage);
            return new OkObjectResult(result.Value);
        }
        catch (InputException e)
        {
            return Error(400, e.Message);
        }
        catch (StructuredFormatException e)
        {
            gate.Record(endpoint, provider.Model, e.Usage);
            logger.LogWarning("{Endpoint} output invalid after retry: {Detail}", endpoint, e.Detail);
            return Error(502, e.Message);
        }
        catch (AiProviderException e)
        {
            return Error(e.StatusCode, e.Message);
        }
    }

    [Function("chat")]
    public async Task<IActionResult> Chat(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "chat")] HttpRequest req, CancellationToken ct)
    {
        PreparedChat chat;
        try
        {
            chat = ChatService.Prepare(await ReadAsync<ChatRequest>(req, ct));
        }
        catch (InputException e)
        {
            return Error(400, e.Message);
        }
        if (Gate(req, "chat") is { } blocked) return blocked;

        if (!options.ChatStreaming) return await ChatOnceAsync(chat, ct);

        // Stream as SSE: data: {"delta": "..."} … then data: {"done": true} or data: {"error": "..."}.
        var res = req.HttpContext.Response;
        res.StatusCode = 200;
        res.ContentType = "text/event-stream; charset=utf-8";
        res.Headers.CacheControl = "no-cache";
        res.Headers["X-Accel-Buffering"] = "no";
        var tokens = AiUsage.Zero;
        try
        {
            await foreach (var evt in provider.StreamChatAsync(chat.System, chat.Messages, ct))
            {
                switch (evt)
                {
                    case ChatDelta d when d.Text.Length > 0:
                        await WriteEventAsync(res, new { delta = d.Text }, ct);
                        break;
                    case ChatCompleted c:
                        tokens = c.Usage;
                        break;
                }
            }
            await WriteEventAsync(res, new { done = true }, ct);
        }
        catch (AiProviderException e)
        {
            await WriteEventAsync(res, new { error = e.Message }, ct);
        }
        catch (OperationCanceledException)
        {
            // client went away
        }
        finally
        {
            gate.Record("chat", provider.Model, tokens);
        }
        return new EmptyResult();
    }

    [Function("usage")]
    public IActionResult Usage([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "usage")] HttpRequest req) =>
        new OkObjectResult(new
        {
            provider = options.Provider,
            model = options.Model,
            pricePerMTok = new { input = options.PriceInputPerMTok, output = options.PriceOutputPerMTok },
            dailyBudgetUsd = options.DailyBudgetUsd,
            today = usage.Snapshot(),
        });

    /// <summary>Fallback when CHAT_STREAMING=false: collect the whole reply and return it once.</summary>
    private async Task<IActionResult> ChatOnceAsync(PreparedChat chat, CancellationToken ct)
    {
        var text = new System.Text.StringBuilder();
        var tokens = AiUsage.Zero;
        try
        {
            await foreach (var evt in provider.StreamChatAsync(chat.System, chat.Messages, ct))
            {
                if (evt is ChatDelta d) text.Append(d.Text);
                else if (evt is ChatCompleted c) tokens = c.Usage;
            }
            return new OkObjectResult(new { reply = text.ToString() });
        }
        catch (AiProviderException e)
        {
            return Error(e.StatusCode, e.Message);
        }
        finally
        {
            gate.Record("chat", provider.Model, tokens);
        }
    }

    private IActionResult? Gate(HttpRequest req, string endpoint)
    {
        var ip = IpRateLimiter.ClientIp(req.Headers["X-Forwarded-For"].FirstOrDefault());
        if (gate.Check(ip, endpoint) is not { } blocked) return null;
        if (blocked.RetryAfterSeconds > 0) req.HttpContext.Response.Headers.RetryAfter = blocked.RetryAfterSeconds.ToString();
        return new ObjectResult(new { error = blocked.Message, retryAfterSeconds = blocked.RetryAfterSeconds }) { StatusCode = blocked.StatusCode };
    }

    private static ObjectResult Error(int status, string message) => new(new { error = message }) { StatusCode = status };

    private static async Task<T?> ReadAsync<T>(HttpRequest req, CancellationToken ct) where T : class
    {
        if (req.ContentLength > 64 * 1024) return null;
        try
        {
            return await JsonSerializer.DeserializeAsync<T>(req.Body, Json, ct);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static async Task WriteEventAsync(HttpResponse res, object payload, CancellationToken ct)
    {
        await res.WriteAsync("data: " + JsonSerializer.Serialize(payload, Json) + "\n\n", ct);
        await res.Body.FlushAsync(ct);
    }
}
