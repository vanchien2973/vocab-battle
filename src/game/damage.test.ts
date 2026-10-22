import { describe, expect, it } from 'vitest';
import { BASE_DAMAGE, calcDamage, comboMultiplier, speedBonus } from './damage';

describe('damage', () => {
  it('grows with combo and caps at x2', () => {
    expect([1, 2, 3, 4, 9].map(comboMultiplier)).toEqual([1, 1.2, 1.5, 2, 2]);
  });

  it('adds a speed bonus for fast answers', () => {
    expect(speedBonus(500)).toBe(3);
    expect(speedBonus(3000)).toBe(1);
    expect(speedBonus(8000)).toBe(0);
  });

  it('combines base, combo and speed', () => {
    expect(calcDamage(1, 9000)).toBe(BASE_DAMAGE);
    expect(calcDamage(2, 9000)).toBe(12);
    expect(calcDamage(3, 1000)).toBe(15 + 3);
    expect(calcDamage(5, 3000)).toBe(20 + 1);
  });

  it('never decreases as combo increases', () => {
    for (let c = 1; c < 10; c++) expect(calcDamage(c + 1, 5000)).toBeGreaterThanOrEqual(calcDamage(c, 5000));
  });
});
