import { describe, it, expect } from 'vitest';
import { computeQuantScore } from '../src/indicators/quant-score';

const rising = Array.from({ length: 30 }, (_, i) => 100 + i * 2);
const flat = Array.from({ length: 30 }, () => 100);

describe('computeQuantScore — 纯本地量化评分', () => {
  it('评分始终为 0-100 的整数', () => {
    const r = computeQuantScore({ closes: rising });
    expect(Number.isInteger(r.score)).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it('30 天序列至少产出 5 个价格类因子', () => {
    const r = computeQuantScore({ closes: rising });
    expect(Object.keys(r.factors).length).toBeGreaterThanOrEqual(5);
  });

  it('强势上行序列方向不应判为偏空', () => {
    const r = computeQuantScore({ closes: rising, vix: Array(30).fill(13) });
    expect(r.direction).not.toBe('bearish');
    expect(r.score).toBeGreaterThanOrEqual(50);
  });

  it('恒定序列不产生 NaN（布林带 %B 守卫）', () => {
    const r = computeQuantScore({ closes: flat });
    expect(Number.isNaN(r.score)).toBe(false);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it('数据不足 20 天时降级为中性', () => {
    const r = computeQuantScore({ closes: [100, 101, 102] });
    expect(r.direction).toBe('neutral');
  });

  it('纳入 VIX / 收益率曲线等美股因子', () => {
    const r = computeQuantScore({
      closes: rising,
      vix: Array(30).fill(15),
      us10y: Array(30).fill(4.2),
      us2y: Array(30).fill(4.5),
    });
    expect(r.factors.vix).toBeDefined();
    expect(r.factors.yieldcurve).toBeDefined();
  });
});
