import { describe, it, expect } from 'vitest';
import { percentile, rollingPercentile, valuationLevel } from '../src/indicators/percentile';

describe('percentile', () => {
  it('空历史返回 50', () => {
    expect(percentile([], 100)).toBe(50);
  });

  it('当前值高于全部历史返回 100', () => {
    expect(percentile([1, 2, 3], 10)).toBe(100);
  });

  it('中位值返回对应百分位', () => {
    // [1,2,3,4] 中 <=2 的有 2 个 → 50%
    expect(percentile([1, 2, 3, 4], 2)).toBe(50);
  });
});

describe('rollingPercentile — 窗口含当前值', () => {
  it('数据不足 2 条返回 null', () => {
    expect(rollingPercentile([1], 60)).toBeNull();
  });

  it('当前值为窗口最高时返回 100', () => {
    // recent=[3,4,5], current=5, <=5 的有 3 个 → 100
    expect(rollingPercentile([1, 2, 3, 4, 5], 3)).toBe(100);
  });
});

describe('valuationLevel — 估值水位', () => {
  it('低分位为 low', () => {
    expect(valuationLevel(10)).toBe('low');
  });
  it('中分位为 fair', () => {
    expect(valuationLevel(50)).toBe('fair');
  });
  it('高分位为 high', () => {
    expect(valuationLevel(90)).toBe('high');
  });
});
