using System.Text.Json;
using System.Text.Json.Nodes;

namespace VocabBattle.Api.Core.Data;

/// <summary>A data request failed in a way the client should see (status code + Vietnamese message).</summary>
public sealed class DataException(int status, string message, JsonNode? current = null, IReadOnlyList<string>? errors = null)
    : Exception(message)
{
    public int Status { get; } = status;
    /// <summary>For 412: the version currently stored, so the client can choose which one to keep.</summary>
    public JsonNode? Current { get; } = current;
    public IReadOnlyList<string> Errors { get; } = errors ?? [];
}

/// <summary>
/// Deck CRUD. Every operation runs inside the caller's own partition (/userId taken from the SWA principal),
/// so another user's deck simply does not exist for them.
/// </summary>
public sealed class DeckService(DataStores stores, TimeProvider time)
{
    private static readonly DeckValidator Validator = new();

    private const string ListSql =
        "SELECT c.id, c.name, c.description, c.level, c.updatedAt, ARRAY_LENGTH(c.items) AS itemCount, " +
        "ARRAY_LENGTH(c.words) AS wordCount FROM c ORDER BY c.updatedAt DESC";

    /// <summary>Summaries without items (cheap list for the "Bộ từ của tôi" page).</summary>
    public async Task<JsonArray> ListAsync(string userId, CancellationToken ct)
    {
        var rows = await stores.Decks.QueryAsync(userId, ListSql, new Dictionary<string, object>(), ct);
        var list = new JsonArray();
        foreach (var r in rows)
        {
            list.Add(new JsonObject
            {
                ["id"] = r["id"]?.DeepClone(),
                ["name"] = r["name"]?.DeepClone(),
                ["description"] = r["description"]?.DeepClone() ?? "",
                ["level"] = r["level"]?.DeepClone() ?? "mixed",
                ["updatedAt"] = r["updatedAt"]?.DeepClone(),
                ["itemCount"] = (int?)r["itemCount"] ?? (int?)r["wordCount"] ?? 0,
            });
        }
        return list;
    }

    public async Task<JsonObject> GetAsync(string userId, string id, CancellationToken ct)
    {
        RequireId(id);
        var stored = await stores.Decks.ReadAsync(userId, id, ct) ?? throw NotFound();
        return DeckModel.ForClient(stored);
    }

    public async Task<JsonObject> CreateAsync(string userId, JsonObject? body, CancellationToken ct)
    {
        var input = Validate(body);
        var existing = await stores.Decks.QueryAsync(userId, "SELECT VALUE COUNT(1) FROM c", new Dictionary<string, object>(), ct);
        var count = existing.Count > 0 ? (int?)existing[0] ?? 0 : 0;
        if (count >= AiShared.Limits.MaxDecksPerUser)
            throw new DataException(409, $"Mỗi tài khoản tối đa {AiShared.Limits.MaxDecksPerUser} bộ từ.");

        var now = time.GetUtcNow().ToString("O");
        var id = input.Id is { } wanted && DeckModel.IdPattern().IsMatch(wanted) ? wanted : DeckModel.NewId();
        try
        {
            return DeckModel.ForClient(await stores.Decks.CreateAsync(userId, ToDoc(input, id, userId, now, now), ct));
        }
        catch (StoreConflictException)
        {
            // The client-chosen id is taken (e.g. a deck synced twice): store it under a new id.
            return DeckModel.ForClient(await stores.Decks.CreateAsync(userId, ToDoc(input, DeckModel.NewId(), userId, now, now), ct));
        }
    }

    /// <summary>Replace a deck if it still has the etag the client read; otherwise 412 with the stored version.</summary>
    public async Task<JsonObject> UpdateAsync(string userId, string id, JsonObject? body, string? ifMatch, CancellationToken ct)
    {
        RequireId(id);
        if (string.IsNullOrWhiteSpace(ifMatch)) throw new DataException(428, "Thiếu If-Match (etag của phiên bản đang sửa).");
        var input = Validate(body);
        var stored = await stores.Decks.ReadAsync(userId, id, ct) ?? throw NotFound();
        if (stored.ETag != ifMatch) throw Conflict(stored);

        var createdAt = (string?)stored.Doc["createdAt"] ?? time.GetUtcNow().ToString("O");
        try
        {
            var doc = ToDoc(input, id, userId, createdAt, time.GetUtcNow().ToString("O"));
            return DeckModel.ForClient(await stores.Decks.ReplaceAsync(userId, doc, ifMatch, ct));
        }
        catch (StorePreconditionException)
        {
            throw Conflict(await stores.Decks.ReadAsync(userId, id, ct));
        }
        catch (StoreNotFoundException)
        {
            throw NotFound();
        }
    }

    /// <summary>Delete a deck and its study progress.</summary>
    public async Task DeleteAsync(string userId, string id, CancellationToken ct)
    {
        RequireId(id);
        if (!await stores.Decks.DeleteAsync(userId, id, ct)) throw NotFound();
        await stores.Progress.DeleteAsync(userId, id, ct);
    }

    private static DeckInput Validate(JsonObject? body)
    {
        var input = body is null ? null : DeckModel.ToInput(body);
        if (input is null) throw new DataException(400, "Dữ liệu bộ từ không hợp lệ.");
        var result = Validator.Validate(input);
        if (!result.IsValid)
        {
            var errors = result.Errors.Select(e => e.ErrorMessage).Distinct().Take(20).ToList();
            throw new DataException(400, errors[0], errors: errors);
        }
        return input;
    }

    /// <summary>The stored document: client fields plus server-owned fields; a userId in the body is ignored.</summary>
    private static JsonObject ToDoc(DeckInput input, string id, string userId, string createdAt, string updatedAt)
    {
        var doc = JsonSerializer.SerializeToNode(input, DeckModel.Json)!.AsObject();
        doc["id"] = id;
        doc["userId"] = userId;
        doc["schemaVersion"] = DeckModel.SchemaVersion;
        doc["createdAt"] = createdAt;
        doc["updatedAt"] = updatedAt;
        return doc;
    }

    internal static void RequireId(string id)
    {
        if (!DeckModel.IdPattern().IsMatch(id)) throw new DataException(400, "Id không hợp lệ.");
    }

    private static DataException NotFound() => new(404, "Không tìm thấy bộ từ.");

    private static DataException Conflict(StoredDoc? current) =>
        current is null
            ? NotFound()
            : new DataException(412, "Bộ từ đã được sửa ở nơi khác. Chọn phiên bản muốn giữ.", DeckModel.ForClient(current));
}
