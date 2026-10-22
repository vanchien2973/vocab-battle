export const BASE_DAMAGE = 10;

/** combo 1 → ×1, 2 → ×1.2, 3 → ×1.5, 4+ → ×2. */
export function comboMultiplier(combo: number): number {
  if (combo >= 4) return 2;
  if (combo === 3) return 1.5;
  if (combo === 2) return 1.2;
  return 1;
}

/** Small reward for answering quickly. */
export function speedBonus(ms: number): number {
  if (ms < 2000) return 3;
  if (ms < 4000) return 1;
  return 0;
}

/** Damage dealt by a correct answer; `combo` already includes this answer. */
export function calcDamage(combo: number, ms: number): number {
  return Math.round(BASE_DAMAGE * comboMultiplier(combo)) + speedBonus(ms);
}
