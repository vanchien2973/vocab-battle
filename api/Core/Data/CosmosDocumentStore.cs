using System.Net;
using System.Text.Json.Nodes;
using Microsoft.Azure.Cosmos;
using Microsoft.Extensions.Logging;

namespace VocabBattle.Api.Core.Data;

/// <summary>The document was not found when replacing it (deleted meanwhile).</summary>
public sealed class StoreNotFoundException() : Exception("Document not found.");

/// <summary>
/// A Cosmos DB container (SDK v3, System.Text.Json). Every call is scoped to one partition, and its
/// request charge is logged and added to today's usage (GET /api/usage → ru).
/// </summary>
public sealed class CosmosDocumentStore(Container container, UsageTracker usage, ILogger logger) : IDocumentStore
{
    private string Name => container.Id;

    public async Task<StoredDoc?> ReadAsync(string partitionKey, string id, CancellationToken ct)
    {
        try
        {
            var r = await container.ReadItemAsync<JsonObject>(id, new PartitionKey(partitionKey), cancellationToken: ct);
            Track("read", r.RequestCharge);
            return new StoredDoc(r.Resource, r.ETag);
        }
        catch (CosmosException e) when (e.StatusCode == HttpStatusCode.NotFound)
        {
            Track("read", e.RequestCharge);
            return null;
        }
    }

    public async Task<StoredDoc> CreateAsync(string partitionKey, JsonObject doc, CancellationToken ct)
    {
        try
        {
            var r = await container.CreateItemAsync(doc, new PartitionKey(partitionKey), cancellationToken: ct);
            Track("create", r.RequestCharge);
            return new StoredDoc(r.Resource, r.ETag);
        }
        catch (CosmosException e) when (e.StatusCode == HttpStatusCode.Conflict)
        {
            Track("create", e.RequestCharge);
            throw new StoreConflictException();
        }
    }

    public async Task<StoredDoc> ReplaceAsync(string partitionKey, JsonObject doc, string? ifMatch, CancellationToken ct)
    {
        try
        {
            var options = new ItemRequestOptions { IfMatchEtag = ifMatch };
            var r = await container.ReplaceItemAsync(doc, (string)doc["id"]!, new PartitionKey(partitionKey), options, ct);
            Track("replace", r.RequestCharge);
            return new StoredDoc(r.Resource, r.ETag);
        }
        catch (CosmosException e) when (e.StatusCode is HttpStatusCode.PreconditionFailed or HttpStatusCode.NotFound)
        {
            Track("replace", e.RequestCharge);
            throw e.StatusCode == HttpStatusCode.NotFound ? new StoreNotFoundException() : new StorePreconditionException();
        }
    }

    public async Task<bool> DeleteAsync(string partitionKey, string id, CancellationToken ct)
    {
        try
        {
            var r = await container.DeleteItemAsync<JsonObject>(id, new PartitionKey(partitionKey), cancellationToken: ct);
            Track("delete", r.RequestCharge);
            return true;
        }
        catch (CosmosException e) when (e.StatusCode == HttpStatusCode.NotFound)
        {
            Track("delete", e.RequestCharge);
            return false;
        }
    }

    public async Task<IReadOnlyList<JsonNode>> QueryAsync(
        string partitionKey, string sql, IReadOnlyDictionary<string, object> parameters, CancellationToken ct)
    {
        var query = new QueryDefinition(sql);
        foreach (var (name, value) in parameters) query = query.WithParameter(name, value);
        var options = new QueryRequestOptions { PartitionKey = new PartitionKey(partitionKey), MaxItemCount = 100 };
        using var it = container.GetItemQueryIterator<JsonNode>(query, requestOptions: options);
        var list = new List<JsonNode>();
        double charge = 0;
        while (it.HasMoreResults)
        {
            var page = await it.ReadNextAsync(ct);
            charge += page.RequestCharge;
            list.AddRange(page.Where(x => x is not null)!);
        }
        Track("query", charge);
        return list;
    }

    private void Track(string operation, double ru)
    {
        usage.RecordRu($"{Name}.{operation}", ru);
        logger.LogInformation("Cosmos {Container}.{Operation} ru={RequestCharge}", Name, operation, ru);
    }
}

/// <summary>Stand-in when COSMOS_CONNECTION_STRING is missing: data endpoints answer 503, AI keeps working.</summary>
public sealed class UnavailableStore : IDocumentStore
{
    public Task<StoredDoc?> ReadAsync(string partitionKey, string id, CancellationToken ct) => throw new StoreUnavailableException();
    public Task<StoredDoc> CreateAsync(string partitionKey, JsonObject doc, CancellationToken ct) => throw new StoreUnavailableException();
    public Task<StoredDoc> ReplaceAsync(string partitionKey, JsonObject doc, string? ifMatch, CancellationToken ct) => throw new StoreUnavailableException();
    public Task<bool> DeleteAsync(string partitionKey, string id, CancellationToken ct) => throw new StoreUnavailableException();
    public Task<IReadOnlyList<JsonNode>> QueryAsync(string partitionKey, string sql, IReadOnlyDictionary<string, object> parameters, CancellationToken ct) =>
        throw new StoreUnavailableException();
}
