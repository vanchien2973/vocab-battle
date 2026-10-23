using System.Text.Json;
using Microsoft.Azure.Cosmos;
using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using VocabBattle.Api.Core;
using VocabBattle.Api.Core.Data;

var builder = FunctionsApplication.CreateBuilder(args);
builder.ConfigureFunctionsWebApplication();

builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton(_ => AiOptions.FromEnvironment());
builder.Services.AddSingleton<IpRateLimiter>();
builder.Services.AddSingleton<UsageTracker>();
builder.Services.AddSingleton<AiGate>();
builder.Services.AddHttpClient("ai", c => c.Timeout = TimeSpan.FromSeconds(90));
builder.Services.AddSingleton<IAiProvider>(sp =>
    AiProviderFactory.Create(sp.GetRequiredService<AiOptions>(), sp.GetRequiredService<IHttpClientFactory>().CreateClient("ai")));
builder.Services.AddSingleton<StructuredService>();
builder.Services.AddSingleton<LookupService>();
builder.Services.AddSingleton<AiTasksService>();

// Cosmos DB: one CosmosClient for the app's lifetime. Without COSMOS_CONNECTION_STRING the data endpoints answer 503.
builder.Services.AddSingleton(_ => DataOptions.FromEnvironment());
builder.Services.AddSingleton(sp =>
{
    var options = sp.GetRequiredService<DataOptions>();
    return options.Configured
        ? new CosmosClient(options.CosmosConnectionString, new CosmosClientOptions
        {
            ApplicationName = "vocab-battle",
            ConnectionMode = ConnectionMode.Gateway,
            UseSystemTextJsonSerializerWithOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web),
        })
        : null!;
});
builder.Services.AddSingleton(sp =>
{
    var options = sp.GetRequiredService<DataOptions>();
    if (!options.Configured)
    {
        var none = new UnavailableStore();
        return new DataStores(none, none, none);
    }
    var db = sp.GetRequiredService<CosmosClient>().GetDatabase(options.DatabaseName);
    var usage = sp.GetRequiredService<UsageTracker>();
    var logger = sp.GetRequiredService<ILoggerFactory>().CreateLogger("Cosmos");
    IDocumentStore Store(string name) => new CosmosDocumentStore(db.GetContainer(name), usage, logger);
    return new DataStores(Store("decks"), Store("progress"), Store("shares"));
});
builder.Services.AddSingleton<DeckService>();
builder.Services.AddSingleton<ProgressService>();
builder.Services.AddSingleton<ShareService>();

builder.Build().Run();
