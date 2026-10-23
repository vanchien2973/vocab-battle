using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using VocabBattle.Api.Core;
using VocabBattle.Api.Core.Data;

namespace VocabBattle.Api.Functions;

/// <summary>
/// Decks, progress and shares. The user always comes from x-ms-client-principal (set by SWA, which also
/// enforces the "authenticated" role on these routes in staticwebapp.config.json); bodies never choose the user.
/// </summary>
public sealed class DataFunctions(
    DeckService decks, ProgressService progress, ShareService shares, IpRateLimiter limiter, DataOptions options,
    ILogger<DataFunctions> logger)
{
    /// <summary>A full deck (500 items with examples) stays well below this; Cosmos documents max out at 2 MB.</summary>
    public const int MaxBodyBytes = 1_500_000;

    [Function("decks")]
    public Task<IActionResult> Decks(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "post", Route = "decks")] HttpRequest req, CancellationToken ct) =>
        RunAsync(req, true, async user => HttpMethods.IsGet(req.Method)
            ? new OkObjectResult(await decks.ListAsync(user!, ct))
            : new ObjectResult(await decks.CreateAsync(user!, await ReadAsync(req, ct), ct)) { StatusCode = 201 });

    [Function("deck")]
    public Task<IActionResult> Deck(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "put", "delete", Route = "decks/{id}")] HttpRequest req, string id,
        CancellationToken ct) =>
        RunAsync(req, true, async user =>
        {
            if (HttpMethods.IsGet(req.Method)) return new OkObjectResult(await decks.GetAsync(user!, id, ct));
            if (HttpMethods.IsPut(req.Method))
                return new OkObjectResult(await decks.UpdateAsync(user!, id, await ReadAsync(req, ct), req.Headers.IfMatch.FirstOrDefault(), ct));
            await decks.DeleteAsync(user!, id, ct);
            return new NoContentResult();
        });

    [Function("progress")]
    public Task<IActionResult> Progress(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "put", Route = "progress/{deckId}")] HttpRequest req, string deckId,
        CancellationToken ct) =>
        RunAsync(req, true, async user => HttpMethods.IsGet(req.Method)
            ? new OkObjectResult(await progress.GetAsync(user!, deckId, ct))
            : new OkObjectResult(await progress.MergeAsync(user!, deckId, await ReadAsync(req, ct), ct)));

    [Function("shares")]
    public Task<IActionResult> CreateShare(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "shares")] HttpRequest req, CancellationToken ct) =>
        RunAsync(req, true, async user =>
        {
            var body = await ReadAsync(req, ct);
            return new ObjectResult(await shares.CreateAsync(user!, (string?)body?["deckId"], ct)) { StatusCode = 201 };
        });

    [Function("share")]
    public Task<IActionResult> GetShare(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "shares/{code}")] HttpRequest req, string code, CancellationToken ct) =>
        RunAsync(req, false, async _ => new OkObjectResult(await shares.GetAsync(code, ct)));

    /// <summary>Authenticate (when required), rate limit, run, and map errors to status codes with a message.</summary>
    private async Task<IActionResult> RunAsync(HttpRequest req, bool requireUser, Func<string?, Task<IActionResult>> run)
    {
        var principal = ClientPrincipal.Parse(req.Headers[ClientPrincipal.Header].FirstOrDefault());
        if (requireUser && principal is null) return Error(401, "Bạn cần đăng nhập.");

        // Signed-in users are limited per account, anonymous share reads per IP.
        var key = principal is not null ? "u:" + principal.UserId : "ip:" + IpRateLimiter.ClientIp(req.Headers["X-Forwarded-For"].FirstOrDefault());
        var decision = limiter.Check(key, "data", options.DataPerMinute, options.DataPerDay, "thao tác dữ liệu");
        if (!decision.Allowed)
        {
            req.HttpContext.Response.Headers.RetryAfter = decision.RetryAfterSeconds.ToString();
            return new ObjectResult(new { error = decision.Message, retryAfterSeconds = decision.RetryAfterSeconds }) { StatusCode = 429 };
        }

        try
        {
            return await run(principal?.UserId);
        }
        catch (DataException e)
        {
            var body = new JsonObject { ["error"] = e.Message };
            if (e.Errors.Count > 1) body["errors"] = new JsonArray(e.Errors.Select(x => (JsonNode?)x).ToArray());
            if (e.Current is not null) body["current"] = e.Current.DeepClone();
            return new ObjectResult(body) { StatusCode = e.Status };
        }
        catch (StoreUnavailableException e)
        {
            logger.LogError("Data endpoint called without Cosmos configuration");
            return Error(503, e.Message);
        }
    }

    private static ObjectResult Error(int status, string message) => new(new { error = message }) { StatusCode = status };

    private static async Task<JsonObject?> ReadAsync(HttpRequest req, CancellationToken ct)
    {
        if (req.ContentLength > MaxBodyBytes) throw new DataException(413, "Dữ liệu quá lớn.");
        try
        {
            using var limited = new MemoryStream();
            await req.Body.CopyToAsync(limited, ct);
            if (limited.Length > MaxBodyBytes) throw new DataException(413, "Dữ liệu quá lớn.");
            limited.Position = 0;
            return await JsonSerializer.DeserializeAsync<JsonNode>(limited, cancellationToken: ct) as JsonObject;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
