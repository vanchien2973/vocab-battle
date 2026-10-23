using VocabBattle.Api.Core.Data;

namespace VocabBattle.Api.Core.Writing;

/// <summary>
/// Daily grading limit, separate from the other AI limits: RATE_WRITING_GRADE_PER_DAY per signed-in user
/// (counted in Cosmos, so it survives restarts) and RATE_WRITING_GRADE_PER_DAY_ANON per IP otherwise
/// (in memory, like the other IP limits). Only successful gradings count.
/// </summary>
public sealed class WritingQuota(AiOptions options, IpRateLimiter limiter, WritingStore store, TimeProvider time)
{
    /// <summary>Null when the user may grade another essay now.</summary>
    public async Task<GateResult?> CheckAsync(string? userId, string ip, CancellationToken ct)
    {
        if (userId is not null)
        {
            try
            {
                if (await store.RemainingTodayAsync(userId, options.WritingGradePerDay, ct) > 0) return null;
                return new GateResult(429, $"Bạn đã dùng hết {options.WritingGradePerDay} lượt chấm bài hôm nay. Quay lại vào ngày mai nhé!", SecondsToMidnight());
            }
            catch (StoreUnavailableException)
            {
                return Memory("u:" + userId, options.WritingGradePerDay);
            }
        }
        return Memory("ip:" + ip, options.WritingGradePerDayAnon);
    }

    /// <summary>
    /// Count a successful grading in memory (anonymous, or signed in without a database). Signed-in gradings
    /// saved to Cosmos are counted by <see cref="WritingStore.SaveAsync"/>.
    /// </summary>
    public void RecordInMemory(string? userId, string ip) => limiter.CountToday(MemoryKey(userId, ip));

    private static string MemoryKey(string? userId, string ip) => userId is not null ? "wg|u:" + userId : "wg|ip:" + ip;

    private GateResult? Memory(string key, int perDay) =>
        limiter.UsedToday("wg|" + key) < perDay
            ? null
            : new GateResult(429, $"Bạn đã dùng hết {perDay} lượt chấm bài hôm nay. Quay lại vào ngày mai nhé!", SecondsToMidnight());

    private int SecondsToMidnight()
    {
        var now = time.GetUtcNow();
        return (int)(now.UtcDateTime.Date.AddDays(1) - now.UtcDateTime).TotalSeconds;
    }
}
