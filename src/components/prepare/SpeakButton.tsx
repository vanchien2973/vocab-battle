import { canSpeak, speak } from './speech';

const supported = canSpeak();

/** Hidden when the browser has no Web Speech API. */
export function SpeakButton({ text }: { text: string }) {
  if (!supported) return null;
  return (
    <button
      type="button"
      className="speak"
      aria-label={`Nghe phát âm ${text}`}
      title="Nghe phát âm"
      onClick={(e) => {
        e.stopPropagation();
        speak(text);
      }}
    >
      🔊
    </button>
  );
}
