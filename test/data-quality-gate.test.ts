import { describe, it, expect } from 'vitest';
import { evaluateDataQualityGate } from '../src/utils/data-quality-gate';
import type { MarketData } from '../src/types/market.js';

function mkMarket(opts: {
  spx?: number | null;
  ixic?: number | null;
  dxy?: number | null;
}): MarketData {
  const price = (v: number | null | undefined, source = 'test') =>
    v != null && v !== 0
      ? { value: v, change: 0, source, sourceGrade: 'A' as const, verifiedAt: 't' }
      : { value: 0, change: 0, source: 'N/A', sourceGrade: 'C' as const, verifiedAt: 't' };

  return {
    timestamp: new Date().toISOString(),
    spx: { price: price(opts.spx ?? null, 'Yahoo ^GSPC') },
    ixic: { price: price(opts.ixic ?? null, 'Yahoo ^IXIC') },
    spy: { code: 'SPY', name: 'SPY', nav: price(null) },
    qqq: { code: 'QQQ', name: 'QQQ', nav: price(null) },
    vix: { value: price(null) },
    dollarIndex: { value: price(opts.dxy ?? null) },
    usTreasury: {
      yield10y: price(null),
      yield2y: price(null),
      tips10y: { value: 0, source: 'N/A', sourceGrade: 'C', verifiedAt: 't' },
    },
  };
}

describe('evaluateDataQualityGate', () => {
  it('无 SPX → red 不可操作', () => {
    const g = evaluateDataQualityGate({
      marketData: mkMarket({ spx: null }),
      overallConfidence: 80,
    });
    expect(g.tier).toBe('red');
    expect(g.actionable).toBe(false);
  });

  it('置信度 40 + 有效 SPX → yellow 可操作', () => {
    const g = evaluateDataQualityGate({
      marketData: mkMarket({ spx: 5200 }),
      overallConfidence: 40,
      anchorSpxPrice: 5205,
    });
    expect(g.tier).toBe('yellow');
    expect(g.actionable).toBe(true);
  });

  it('置信度 <35 → red', () => {
    const g = evaluateDataQualityGate({
      marketData: mkMarket({ spx: 5200 }),
      overallConfidence: 30,
      anchorSpxPrice: 5200,
    });
    expect(g.tier).toBe('red');
    expect(g.actionable).toBe(false);
  });

  it('锚定偏差 >3% → red', () => {
    const g = evaluateDataQualityGate({
      marketData: mkMarket({ spx: 5000 }),
      overallConfidence: 80,
      anchorSpxPrice: 5200,
    });
    expect(g.tier).toBe('red');
    expect(g.actionable).toBe(false);
  });

  it('高置信 + 锚定贴合 → green', () => {
    const g = evaluateDataQualityGate({
      marketData: mkMarket({ spx: 5200, ixic: 16500, dxy: 104 }),
      overallConfidence: 75,
      validations: [
        {
          field: 'spx.price',
          sources: [
            { value: 5200, source: 'a', grade: 'A', timestamp: 't' },
            { value: 5201, source: 'b', grade: 'A', timestamp: 't' },
          ],
          consensus: 'verified',
          finalValue: 5200,
          confidence: 95,
        },
      ],
      anchorSpxPrice: 5202,
    });
    expect(g.tier).toBe('green');
    expect(g.actionable).toBe(true);
  });
});
