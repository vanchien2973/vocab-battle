using System.Security.Cryptography;
using System.Text.Json.Nodes;

namespace VocabBattle.Api.Core.Data;

/// <summary>
/// Short share codes (container "shares", partition /code). A share is a snapshot of one of the caller's
/// decks that anyone with the code can read for 30 days (Cosmos TTL deletes it afterwards).
/// </summary>
public sealed class ShareService(DataStores stores, TimeProvider time)
{
    /// <summary>No 0/O/1/I so codes can be read aloud or typed.</summary>
    public const string Alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    private const int MaxAttempts = 5;

    public static string NewCode(int length)
    {
        Span<char> chars = stackalloc char[length];
        for (var i = 0; i < length; i++) chars[i] = Alphabet[RandomNumberGenerator.GetInt32(Alphabet.Length)];
        return new string(chars);
    }

    public static string? NormalizeCode(string? code)
    {
        var c = code?.Trim().ToUpperInvariant() ?? "";
        return c.Length == AiShared.Limits.ShareCodeLength && c.All(Alphabet.Contains) ? c : null;
    }

    public async Task<JsonObject> CreateAsync(string userId, string? deckId, CancellationToken ct)
    {
        DeckService.RequireId(deckId ?? "");
        var stored = await stores.Decks.ReadAsync(userId, deckId!, ct) ?? throw new DataException(404, "Không tìm thấy bộ từ.");
        var deck = DeckModel.Migrate(stored.Doc);
        var snapshot = new JsonObject
        {
            ["name"] = deck["name"]?.DeepClone(),
            ["description"] = deck["description"]?.DeepClone() ?? "",
            ["level"] = deck["level"]?.DeepClone() ?? "mixed",
            ["items"] = deck["items"]?.DeepClone() ?? new JsonArray(),
            ["schemaVersion"] = DeckModel.SchemaVersion,
        };
        var now = time.GetUtcNow();
        var expires = now.AddSeconds(AiShared.Limits.ShareTtlSeconds);
        for (var attempt = 1; ; attempt++)
        {
            var code = NewCode(AiShared.Limits.ShareCodeLength);
            var doc = new JsonObject
            {
                ["id"] = code,
                ["code"] = code,
                ["deck"] = snapshot.DeepClone(),
                ["createdAt"] = now.ToString("O"),
                ["expiresAt"] = expires.ToString("O"),
                ["ttl"] = AiShared.Limits.ShareTtlSeconds,
            };
            try
            {
                await stores.Shares.CreateAsync(code, doc, ct);
                return new JsonObject { ["code"] = code, ["expiresAt"] = expires.ToString("O") };
            }
            catch (StoreConflictException) when (attempt < MaxAttempts)
            {
                // Code already used: draw another one.
            }
        }
    }

    /// <summary>Public: anyone with the code can read the snapshot.</summary>
    public async Task<JsonObject> GetAsync(string? code, CancellationToken ct)
    {
        var c = NormalizeCode(code) ?? throw new DataException(400, "Mã chia sẻ không hợp lệ.");
        var stored = await stores.Shares.ReadAsync(c, c, ct) ?? throw new DataException(404, "Mã chia sẻ không tồn tại hoặc đã hết hạn.");
        return new JsonObject
        {
            ["code"] = c,
            ["deck"] = DeckModel.Migrate(stored.Doc["deck"]!.AsObject()),
            ["expiresAt"] = stored.Doc["expiresAt"]?.DeepClone(),
        };
    }
}
