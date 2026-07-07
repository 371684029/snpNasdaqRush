// 尾部风险指数单测

import { describe, it, expect } from 'vitest';
import { computeTailRiskIndex } from '../src/utils/tail-risk.js';
import type { TailRisk } from '../src/types/analysis.js';

function mkRisk(probability: number, label = 'test'): TailRisk {
  return { risk: label, probability, impact: 'x', trigger: 'y', mitigation: 'z' };
}

describe('computeTailRiskIndex', () => {
  it('空数组返回 0', () => {
    const r = computeTailRiskIndex([]);
    expect(r.index).toBe(0);
    expect(r.rawUnion).toBe(0);
  });

  it('单一风险等于其概率', () => {
    const r = computeTailRiskIndex([mkRisk(20)]);
    expect(r.index).toBe(20);
  });

  it('多项风险被 dampen（不超过最高单项太多）', () => {
    const r = computeTailRiskIndex([mkRisk(30), mkRisk(25), mkRisk(20)]);
    expect(r.index).toBeLessThanOrEqual(50);
    expect(r.index).toBeGreaterThanOrEqual(30);
  });

  it('朴素并概率被上限约束', () => {
    const r = computeTailRiskIndex([mkRisk(40), mkRisk(35), mkRisk(30)], 50);
    expect(r.index).toBeLessThanOrEqual(50);
    expect(r.rawUnion).toBeGreaterThan(50); // 朴素概率 > cap
  });

  it('maxCap 参数生效', () => {
    const r = computeTailRiskIndex([mkRisk(80)], 30);
    expect(r.index).toBe(30);
  });

  it('概率被 clamp 到 0-100', () => {
    const r = computeTailRiskIndex([mkRisk(-10), mkRisk(150)]);
    expect(r.index).toBeGreaterThanOrEqual(0);
    expect(r.index).toBeLessThanOrEqual(50);
  });
});
