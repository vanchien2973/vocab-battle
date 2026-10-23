export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type Cefr = (typeof CEFR_LEVELS)[number];

/** Shape of api/AiShared/lookup.schema.json. */
export interface LookupEntry {
  word: string;
  /** "word" for a single word, otherwise the kind of expression that was looked up. */
  itemType: 'word' | 'collocation' | 'phrasal_verb' | 'idiom' | 'pattern';
  ipa: string;
  cefr: Cefr;
  senses: { partOfSpeech: string; meaningVi: string; definitionEn: string }[];
  examples: { en: string; vi: string }[];
  collocations: string[];
  synonyms: string[];
  antonyms: string[];
  commonMistakes: { mistake: string; correction: string; explanationVi: string }[];
}

export type ChatMode = 'freeTalk' | 'correct' | 'explain' | 'practice';
export const CHAT_MODES: readonly ChatMode[] = ['freeTalk', 'correct', 'explain', 'practice'];

export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

/** What the browser sends; the server owns the system prompt and model. */
export interface ChatRequest {
  mode: ChatMode;
  level?: Cefr;
  /** Words or phrases; `type` is an item type such as "phrasal_verb". */
  words?: { word: string; meaning?: string; type?: string }[];
  messages: ChatMsg[];
}

/** UI-facing AI access; implemented by the server API or a direct (BYOK) provider call. */
export interface AiClient {
  readonly kind: 'server' | 'direct';
  lookup(word: string, signal?: AbortSignal): Promise<LookupEntry>;
  /** Streams reply text through onDelta (all at once if the transport buffers) and resolves with the full reply. */
  chat(req: ChatRequest, onDelta: (text: string) => void, signal?: AbortSignal): Promise<string>;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'AiError';
  }
}
