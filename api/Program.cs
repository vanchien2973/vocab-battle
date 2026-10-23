using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using VocabBattle.Api.Core;

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
builder.Services.AddSingleton<LookupService>();

builder.Build().Run();
