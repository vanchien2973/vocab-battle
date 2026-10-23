using System.Text.Json.Nodes;

namespace VocabBattle.Api.Core.Data;

/// <summary>A stored JSON document and the etag of that version.</summary>
public sealed record StoredDoc(JsonObject Doc, string ETag);

/// <summary>The document was changed since the given etag (HTTP 412).</summary>
public sealed class StorePreconditionException() : Exception("Document changed since it was read.");

/// <summary>A document with this id already exists in the partition (HTTP 409).</summary>
public sealed class StoreConflictException() : Exception("Document already exists.");

/// <summary>Cosmos DB is not configured (no COSMOS_CONNECTION_STRING).</summary>
public sealed class StoreUnavailableException() : Exception("Chưa cấu hình cơ sở dữ liệu (COSMOS_CONNECTION_STRING).");

/// <summary>
/// One container, always addressed by partition key, so a user's request can only ever touch that
/// user's partition. The Cosmos implementation is <see cref="CosmosDocumentStore"/>; tests use an in-memory one.
/// </summary>
public interface IDocumentStore
{
    Task<StoredDoc?> ReadAsync(string partitionKey, string id, CancellationToken ct);
    Task<StoredDoc> CreateAsync(string partitionKey, JsonObject doc, CancellationToken ct);
    /// <summary>Replace; with <paramref name="ifMatch"/> only when the stored etag still matches.</summary>
    Task<StoredDoc> ReplaceAsync(string partitionKey, JsonObject doc, string? ifMatch, CancellationToken ct);
    Task<bool> DeleteAsync(string partitionKey, string id, CancellationToken ct);
    /// <summary>A single-partition query; <paramref name="sql"/> is a constant with @parameters.</summary>
    Task<IReadOnlyList<JsonNode>> QueryAsync(string partitionKey, string sql, IReadOnlyDictionary<string, object> parameters, CancellationToken ct);
}

/// <summary>The three containers of the "vocabbattle" database.</summary>
public sealed record DataStores(IDocumentStore Decks, IDocumentStore Progress, IDocumentStore Shares);
