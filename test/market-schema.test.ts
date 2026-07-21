import { describe, it, expect } from 'vitest';
import { isValidMarketNumber } from '../src/schemas/market';

describe('isValidMarketNumber', () => {
  it('接受正常正数', () => {
    expect(isValidMarketNumber(5200.5)).toBe(true);
    expect(isValidMarketNumber(-1.2)).toBe(true); // TIPS 可为负
  });

  it('拒绝 0（占位）', () => {
    expect(isValidMarketNumber(0)).toBe(false);
  });

  it('拒绝 null / undefined / NaN / Inf', () => {
    expect(isValidMarketNumber(null)).toBe(false);
    expect(isValidMarketNumber(undefined)).toBe(false);
    expect(isValidMarketNumber(Number.NaN)).toBe(false);
    expect(isValidMarketNumber(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
