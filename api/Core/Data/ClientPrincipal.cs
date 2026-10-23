using System.Text;
using System.Text.Json;

namespace VocabBattle.Api.Core.Data;

/// <summary>
/// The signed-in user as SWA's front end passes it in the <c>x-ms-client-principal</c> header (base64 JSON).
/// SWA strips this header from incoming requests and sets it itself, so it is the only trusted source of
/// identity: user ids sent in request bodies are always ignored.
/// </summary>
public sealed record ClientPrincipal(string UserId, string IdentityProvider, string UserDetails, IReadOnlyList<string> Roles)
{
    public const string Header = "x-ms-client-principal";
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private sealed record Raw(string? UserId, string? IdentityProvider, string? UserDetails, List<string>? UserRoles);

    /// <summary>The authenticated user, or null when the header is missing, malformed or not authenticated.</summary>
    public static ClientPrincipal? Parse(string? header)
    {
        if (string.IsNullOrWhiteSpace(header) || header.Length > 8192) return null;
        try
        {
            var raw = JsonSerializer.Deserialize<Raw>(Encoding.UTF8.GetString(Convert.FromBase64String(header)), Web);
            if (raw?.UserId is not { Length: > 0 and <= 128 } userId) return null;
            var roles = raw.UserRoles ?? [];
            if (!roles.Contains("authenticated")) return null;
            return new ClientPrincipal(userId, raw.IdentityProvider ?? "", raw.UserDetails ?? "", roles);
        }
        catch (Exception e) when (e is FormatException or JsonException or ArgumentException)
        {
            return null;
        }
    }
}
