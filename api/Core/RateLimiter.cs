using System.Net;

namespace VocabBattle.Api.Core;

public sealed record RateDecision(bool Allowed, int RetryAfterSeconds = 0, string? Message = null)
{
    public static readonly RateDecision Ok = new(true);
}

/// <summary>
/// Fixed-window limits per client IP: a per-endpoint limit per minute and an overall limit per UTC day.
/// In memory, so limits are per instance and reset on cold start (see README).
/// </summary>
public sealed class IpRateLimiter(TimeProvider time)
{
    private readonly Lock _gate = new();
    private readonly Dictionary<string, (long Window, int Count)> _counters = [];
    private long _lastSweepMinute;

    /// <param name="what">What the daily limit counts, for the message (e.g. "AI").</param>
    public RateDecision Check(string ip, string endpoint, int perMinute, int perDay, string what = "AI")
    {
        var now = time.GetUtcNow();
        var minute = now.ToUnixTimeSeconds() / 60;
        var day = now.ToUnixTimeSeconds() / 86_400;
        lock (_gate)
        {
            Sweep(minute, day);
            var minuteKey = $"m|{endpoint}|{ip}";
            var dayKey = $"d|{ip}";
            var m = Get(minuteKey, minute);
            var d = Get(dayKey, day);
            if (d >= perDay)
            {
                var retry = (int)((day + 1) * 86_400 - now.ToUnixTimeSeconds());
                return new RateDecision(false, retry, $"Bạn đã dùng hết {perDay} lượt {what} hôm nay. Quay lại vào ngày mai nhé!");
            }
            if (m >= perMinute)
            {
                var retry = (int)((minute + 1) * 60 - now.ToUnixTimeSeconds());
                return new RateDecision(false, Math.Max(1, retry), $"Bạn gửi quá nhanh. Đợi {Math.Max(1, retry)} giây rồi thử lại.");
            }
            _counters[minuteKey] = (minute, m + 1);
            _counters[dayKey] = (day, d + 1);
            return RateDecision.Ok;
        }
    }

    /// <summary>Daily count without consuming (for limits that only count successful requests).</summary>
    public int UsedToday(string key)
    {
        var day = time.GetUtcNow().ToUnixTimeSeconds() / 86_400;
        lock (_gate) return Get($"d|{key}", day);
    }

    /// <summary>Add one to the daily count of <paramref name="key"/>.</summary>
    public void CountToday(string key)
    {
        var day = time.GetUtcNow().ToUnixTimeSeconds() / 86_400;
        lock (_gate)
        {
            _counters[$"d|{key}"] = (day, Get($"d|{key}", day) + 1);
        }
    }

    private int Get(string key, long window) =>
        _counters.TryGetValue(key, out var c) && c.Window == window ? c.Count : 0;

    /// <summary>Drop expired counters about once a minute so memory stays bounded.</summary>
    private void Sweep(long minute, long day)
    {
        if (minute == _lastSweepMinute) return;
        _lastSweepMinute = minute;
        foreach (var (key, c) in _counters.ToList())
        {
            var current = key[0] == 'm' ? minute : day;
            if (c.Window != current) _counters.Remove(key);
        }
    }

    /// <summary>
    /// Client IP from the first X-Forwarded-For entry (set by the SWA front end), without the port.
    /// Falls back to "unknown" so all unidentified callers share one bucket.
    /// </summary>
    public static string ClientIp(string? forwardedFor)
    {
        var first = forwardedFor?.Split(',')[0].Trim();
        if (string.IsNullOrEmpty(first)) return "unknown";
        if (IPEndPoint.TryParse(first, out var ep)) return ep.Address.ToString();
        return IPAddress.TryParse(first, out var ip) ? ip.ToString() : "unknown";
    }
}
