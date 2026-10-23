using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Azure.Cosmos;
using Microsoft.Extensions.Logging.Abstractions;
using VocabBattle.Api.Core;
using VocabBattle.Api.Core.Data;

namespace VocabBattle.Api.Tests;

/// <summary>
/// End-to-end against the Azure Cosmos DB Emulator. Skipped unless COSMOS_EMULATOR_CONNECTION_STRING is set
/// (CI has no emulator). Example: AccountEndpoint=https://localhost:8081/;AccountKey=&lt;emulator key&gt;
/// </summary>
public class CosmosEmulatorTests
{
    [Fact]
    public async Task Deck_crud_etag_and_partition_isolation_against_emulator()
    {
        var conn = Environment.GetEnvironmentVariable("COSMOS_EMULATOR_CONNECTION_STRING");
        Assert.SkipWhen(string.IsNullOrWhiteSpace(conn), "COSMOS_EMULATOR_CONNECTION_STRING is not set (no Cosmos DB Emulator).");
        var ct = TestContext.Current.CancellationToken;

        using var client = new CosmosClient(conn, new CosmosClientOptions
        {
            ConnectionMode = ConnectionMode.Gateway,
            LimitToEndpoint = true,
            UseSystemTextJsonSerializerWithOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web),
            // The emulator uses a self-signed certificate.
            HttpClientFactory = () => new HttpClient(new HttpClientHandler
            {
                ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator,
            }),
        });
        var dbName = "vocabbattle-test-" + Guid.NewGuid().ToString("N")[..8];
        var db = (await client.CreateDatabaseAsync(dbName, throughput: 400, cancellationToken: ct)).Database;
        try
        {
            var usage = new UsageTracker(TimeProvider.System);
            async Task<IDocumentStore> Container(string name, string pk)
            {
                await db.CreateContainerAsync(new ContainerProperties(name, pk), cancellationToken: ct);
                return new CosmosDocumentStore(db.GetContainer(name), usage, NullLogger.Instance);
            }
            var stores = new DataStores(await Container("decks", "/userId"), await Container("progress", "/userId"), await Container("shares", "/code"));
            var decks = new DeckService(stores, TimeProvider.System);

            var body = JsonNode.Parse("""
                { "name": "Emulator", "description": "", "level": "B1",
                  "items": [{ "id": "i1", "type": "phrasal_verb", "text": "look into", "meaning": "điều tra", "examples": [], "tags": [] }] }
                """)!.AsObject();
            var created = await decks.CreateAsync("alice", body, ct);
            var id = (string)created["id"]!;

            Assert.Single(await decks.ListAsync("alice", ct));
            Assert.Empty(await decks.ListAsync("bob", ct));
            await Assert.ThrowsAsync<DataException>(() => decks.GetAsync("bob", id, ct));

            var etag = (string?)created["_etag"];
            await decks.UpdateAsync("alice", id, body, etag, ct);
            var stale = await Assert.ThrowsAsync<DataException>(() => decks.UpdateAsync("alice", id, body, etag, ct));
            Assert.Equal(412, stale.Status);

            var share = await new ShareService(stores, TimeProvider.System).CreateAsync("alice", id, ct);
            var got = await new ShareService(stores, TimeProvider.System).GetAsync((string?)share["code"], ct);
            Assert.Equal("Emulator", (string?)got["deck"]!["name"]);
            Assert.True(usage.Snapshot().Ru.Total.RequestUnits > 0);
        }
        finally
        {
            await db.DeleteAsync(cancellationToken: CancellationToken.None);
        }
    }
}
