import Ajv from 'ajv';
import prompts from '../../api/AiShared/prompts.json';
import lookupSchema from '../../api/AiShared/lookup.schema.json';
import type { LookupEntry } from './types';

/** The same prompts and schema the server embeds (api/AiShared). Used by the direct (BYOK) client. */
export { prompts, lookupSchema };

const validate = new Ajv({ allErrors: false }).compile<LookupEntry>(lookupSchema);

/** Returns the parsed entry, or null when the text is not valid JSON matching the schema. */
export function parseLookup(text: string): LookupEntry | null {
  try {
    const data: unknown = JSON.parse(text);
    return validate(data) ? data : null;
  } catch {
    return null;
  }
}

export const MAX_WORD_LENGTH = 40;

/** Mirrors LookupService.NormalizeWord on the server. */
export function normalizeWord(input: string): string | null {
  const word = input.trim().replace(/\s+/g, ' ').toLowerCase();
  return word.length > 0 && word.length <= MAX_WORD_LENGTH && /^\p{L}[\p{L}' -]*$/u.test(word) ? word : null;
}
