namespace VocabBattle.Api.Core;

/// <summary>Cosmos DB and data-endpoint settings from SWA Application settings.</summary>
public sealed record DataOptions
{
    public string? CosmosConnectionString { get; init; }
    public string DatabaseName { get; init; } = "vocabbattle";
    public int DataPerMinute { get; init; } = 60;
    public int DataPerDay { get; init; } = 3000;

    public bool Configured => !string.IsNullOrWhiteSpace(CosmosConnectionString);

    public static DataOptions FromEnvironment() => From(Environment.GetEnvironmentVariable);

    public static DataOptions From(Func<string, string?> get)
    {
        string? Str(string key) => string.IsNullOrWhiteSpace(get(key)) ? null : get(key)!.Trim();
        int Int(string key, int fallback) => int.TryParse(Str(key), out var v) && v > 0 ? v : fallback;
        var d = new DataOptions();
        return new DataOptions
        {
            CosmosConnectionString = Str("COSMOS_CONNECTION_STRING"),
            DatabaseName = Str("COSMOS_DATABASE") ?? d.DatabaseName,
            DataPerMinute = Int("RATE_DATA_PER_MINUTE", d.DataPerMinute),
            DataPerDay = Int("RATE_DATA_PER_DAY", d.DataPerDay),
        };
    }
}
