import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../game/rng';
import { ROOM_ALPHABET, generateRoomCode, normalizeRoomCode, peerIdForRoom, roomFromSearch, roomLink } from './roomCode';

describe('room code', () => {
  it('generates 6 unambiguous characters', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode(rng);
      expect(code).toMatch(/^[A-Z0-9]{6}$/);
      expect([...code].every((c) => ROOM_ALPHABET.includes(c))).toBe(true);
    }
  });

  it('normalizes user input', () => {
    expect(normalizeRoomCode(' ab-cd ef ')).toBe('ABCDEF');
    expect(normalizeRoomCode('ABC')).toBeNull();
    expect(normalizeRoomCode('ABCDE0')).toBeNull(); // 0 is not in the alphabet
  });

  it('builds peer ids and links', () => {
    expect(peerIdForRoom('ABCDEF')).toBe('vocabbattle-ABCDEF');
    expect(roomLink('ABCDEF', 'https://x.github.io', '/vocab-battle/')).toBe('https://x.github.io/vocab-battle/?room=ABCDEF');
    expect(roomFromSearch('?room=abcdef')).toBe('ABCDEF');
    expect(roomFromSearch('?x=1')).toBeNull();
  });
});
