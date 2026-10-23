using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using VocabBattle.Api.Core;
using VocabBattle.Api.Core.Data;
using VocabBattle.Api.Core.Writing;

namespace VocabBattle.Api.Functions;

/// <summary>
/// VSTEP writing: prompt generation, grading (saved to the user's history when signed in) and history.
/// The user always comes from x-ms-client-principal; bodies never choose the user.
/// </summary>
public sealed class WritingFunctions(
    AiOptions options, AiGate gate, WritingService writing, WritingStore store, WritingQuota quota, IpRateLimiter limiter,
    DataOptions dataOptions, ILogger<WritingFunctions> logger)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [Function("writing-generate-prompt")]
    public async Task<IActionResult> GeneratePrompt(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "writing/generate-prompt")] HttpRequest req, CancellationToken ct)
    {
        if (await ReadAsync<WritingPromptInput>(req, ct) is not { } body) return Error(400, "Yêu cầu không hợp lệ.");
        try
        {
            WritingService.Precheck(body);
        }
        catch (InputException e)
        {
            return Error(400, e.Message);
        }
        if (Blocked(req, gate.Check(Ip(req), "writing-prompt")) is { } blocked) return blocked;
        try
        {
            var r = await writing.GeneratePromptAsync(body, ct);
            gate.Record("writing-prompt", options.Model ?? "", r.Usage);
            return new OkObjectResult(r.Value);
        }
        catch (StructuredFormatException e)
        {
            gate.Record("writing-prompt", options.Model ?? "", e.Usage);
            logger.LogWarning("writing-prompt output invalid after retry: {Detail}", e.Detail);
            return Error(502, e.Message);
        }
        catch (AiProviderException e)
        {
            return Error(e.StatusCode, e.Message);
        }
    }

    /// <summary>Validate → daily grading quota → AI gate (budget, per-minute) → grade → save when signed in.</summary>
    [Function("writing-grade")]
    public async Task<IActionResult> Grade(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "writing/grade")] HttpRequest req, CancellationToken ct)
    {
        CheckedGrade input;
        try
        {
            input = WritingService.CheckGrade(await ReadAsync<GradeWritingInput>(req, ct));
        }
        catch (InputException e)
        {
            return Error(400, e.Message);
        }
        var user = ClientPrincipal.Parse(req.Headers[ClientPrincipal.Header].FirstOrDefault());
        if (Blocked(req, await quota.CheckAsync(user?.UserId, Ip(req), ct)) is { } overQuota) return overQuota;
        if (Blocked(req, gate.Check(Ip(req), "writing-grade")) is { } blocked) return blocked;

        AiTaskResult graded;
        try
        {
            graded = await writing.GradeAsync(input, ct);
            Record(graded.Usage);
        }
        catch (StructuredFormatException e)
        {
            Record(e.Usage);
            logger.LogWarning("writing-grade output invalid after retry: {Detail}", e.Detail);
            return Error(502, e.Message);
        }
        catch (AiProviderException e)
        {
            return Error(e.StatusCode, e.Message);
        }

        var response = new JsonObject { ["result"] = graded.Value };
        if (user is not null)
        {
            try
            {
                response["saved"] = await store.SaveAsync(user.UserId, input, graded.Value, ct);
            }
            catch (StoreUnavailableException)
            {
                // No database configured: the browser keeps the attempt locally.
            }
            catch (Exception e) when (e is DataException or StorePreconditionException or StoreConflictException)
            {
                logger.LogError(e, "Saving a graded essay failed");
            }
        }
        return new OkObjectResult(response);
    }

    [Function("writings")]
    public Task<IActionResult> History(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "writings")] HttpRequest req, CancellationToken ct) =>
        RunDataAsync(req, async user => new OkObjectResult(await store.HistoryAsync(user, ct)));

    [Function("writing")]
    public Task<IActionResult> Writing(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "delete", Route = "writings/{id}")] HttpRequest req, string id, CancellationToken ct) =>
        RunDataAsync(req, async user =>
        {
            if (HttpMethods.IsGet(req.Method)) return new OkObjectResult(await store.GetAsync(user, id, ct));
            await store.DeleteAsync(user, id, ct);
            return new NoContentResult();
        });

    private void Record(AiUsage usage) =>
        gate.Record("writing-grade", options.EffectiveGradingModel, usage, options.GradingPriceInputPerMTok, options.GradingPriceOutputPerMTok);

    /// <summary>Signed-in only, rate limited like the other data endpoints.</summary>
    private async Task<IActionResult> RunDataAsync(HttpRequest req, Func<string, Task<IActionResult>> run)
    {
        var principal = ClientPrincipal.Parse(req.Headers[ClientPrincipal.Header].FirstOrDefault());
        if (principal is null) return Error(401, "Bạn cần đăng nhập.");
        var decision = limiter.Check("u:" + principal.UserId, "data", dataOptions.DataPerMinute, dataOptions.DataPerDay, "thao tác dữ liệu");
        if (!decision.Allowed)
            return Blocked(req, new GateResult(429, decision.Message!, decision.RetryAfterSeconds))!;
        try
        {
            return await run(principal.UserId);
        }
        catch (DataException e)
        {
            return Error(e.Status, e.Message);
        }
        catch (StoreUnavailableException e)
        {
            return Error(503, e.Message);
        }
    }

    private static string Ip(HttpRequest req) => IpRateLimiter.ClientIp(req.Headers["X-Forwarded-For"].FirstOrDefault());

    private static IActionResult? Blocked(HttpRequest req, GateResult? blocked)
    {
        if (blocked is null) return null;
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
}
