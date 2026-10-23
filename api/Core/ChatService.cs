namespace VocabBattle.Api.Core;

public sealed record WordRef(string Word, string? Meaning);

/// <summary>What the browser may send. There is deliberately no system prompt or model field.</summary>
public sealed record ChatRequest(string? Mode, string? Level, List<WordRef>? Words, List<ChatMessage>? Messages);

public sealed record PreparedChat(string System, IReadOnlyList<ChatMessage> Messages);

/// <summary>
/// Builds the provider request from a fixed, server-side system prompt. The same trimming rules live in
/// src/ai/chatHistory.ts so BYOK mode behaves the same.
/// </summary>
public static class ChatService
{
    public const int MaxMessages = 20;
    public const int MaxUserChars = 1000;
    public const int MaxAssistantChars = 1500;
    public const int MaxTotalChars = 8000;
    public const int MaxWords = 50;
    public static readonly string[] Levels = ["A1", "A2", "B1", "B2", "C1", "C2"];

    public static PreparedChat Prepare(ChatRequest? request)
    {
        if (request is null) throw new InputException("Thiếu nội dung yêu cầu.");
        var mode = request.Mode ?? "";
        if (!AiShared.Prompts.ChatModes.TryGetValue(mode, out var modePrompt))
            throw new InputException("Chế độ chat không hợp lệ.");

        var last = request.Messages?.LastOrDefault();
        if (last is null || last.Role != "user" || string.IsNullOrWhiteSpace(last.Content))
            throw new InputException("Tin nhắn cuối phải là câu hỏi của bạn.");
        if (last.Content.Length > MaxUserChars)
            throw new InputException($"Tin nhắn tối đa {MaxUserChars} ký tự.");

        var messages = TrimHistory(request.Messages!);
        var context = ContextNote(request.Level, request.Words);
        if (context is not null)
        {
            messages[0] = messages[0] with { Content = context + "\n\n" + messages[0].Content };
        }
        return new PreparedChat(AiShared.Prompts.ChatBase + "\n\n" + modePrompt, messages);
    }

    /// <summary>
    /// Keep only user/assistant turns, cap each message, keep the last 20, drop the oldest until the total fits,
    /// and make sure the conversation starts with a user turn.
    /// </summary>
    public static List<ChatMessage> TrimHistory(IEnumerable<ChatMessage> history)
    {
        var msgs = history
            .Where(m => m.Role is "user" or "assistant" && !string.IsNullOrWhiteSpace(m.Content))
            .Select(m => m with { Content = Truncate(m.Content, m.Role == "user" ? MaxUserChars : MaxAssistantChars) })
            .TakeLast(MaxMessages)
            .ToList();
        while (msgs.Count > 1 && msgs.Sum(m => m.Content.Length) > MaxTotalChars) msgs.RemoveAt(0);
        while (msgs.Count > 0 && msgs[0].Role != "user") msgs.RemoveAt(0);
        return msgs;
    }

    /// <summary>Learner info is passed as data in the first user turn, never in the system prompt.</summary>
    public static string? ContextNote(string? level, IReadOnlyList<WordRef>? words)
    {
        var lv = Levels.Contains(level) ? level! : null;
        var list = (words ?? [])
            .Where(w => !string.IsNullOrWhiteSpace(w.Word))
            .Take(MaxWords)
            .Select(w => string.IsNullOrWhiteSpace(w.Meaning) ? Truncate(w.Word, 40) : $"{Truncate(w.Word, 40)} ({Truncate(w.Meaning, 60)})")
            .ToList();
        if (lv is null && list.Count == 0) return null;
        return AiShared.Prompts.ContextTemplate
            .Replace("{level}", lv ?? "unknown")
            .Replace("{words}", list.Count == 0 ? "none" : string.Join("; ", list));
    }

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];
}
