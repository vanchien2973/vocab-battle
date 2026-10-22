import { defaultRng, type Rng } from '../game/rng';

export const PEER_PREFIX = 'vocabbattle-';
export const ROOM_CODE_LENGTH = 6;
/** No 0/O/1/I to avoid typos when reading the code aloud. */
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomCode(rng: Rng = defaultRng): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_ALPHABET[Math.floor(rng() * ROOM_ALPHABET.length)];
  return code;
}

/** Uppercase and strip spaces/dashes; returns null if it is not a valid code. */
export function normalizeRoomCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== ROOM_CODE_LENGTH) return null;
  return [...code].every((c) => ROOM_ALPHABET.includes(c)) ? code : null;
}

export function peerIdForRoom(code: string): string {
  return PEER_PREFIX + code;
}

export function roomFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search).get('room');
  return raw ? normalizeRoomCode(raw) : null;
}

export function roomLink(code: string, origin: string, basePath: string): string {
  return `${origin}${basePath}?room=${code}`;
}
