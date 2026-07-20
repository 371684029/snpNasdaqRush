import { describe, it, expect } from 'vitest';
import { scoreToAdvice, resolveOperationalAdvice, checkConsistency } from '../src/utils/plain-advice';

describe('scoreToAdvice — 分数映射人话', () => {
  it('分档正确', () => {
    expect(scoreToAdvice(20).label).toBe('强烈偏空');
    expect(scoreToAdvice(40).label).toBe('偏空');
    expect(scoreToAdvice(50).label).toBe('中性');
    expect(scoreToAdvice(65).label).toBe('偏多');
    expect(scoreToAdvice(90).label).toBe('强烈偏多');
  });
});

describe('resolveOperationalAdvice — 统一操作建议出口优先级', () => {
  it('数据门禁不可用 → data_gate 最高优先', () => {
    const a = resolveOperationalAdvice({ dataActionable: false, llmScore: 90 });
    expect(a?.source).toBe('data_gate');
  });

  it('双分冲突弃权 → dual_conflict', () => {
    const a = resolveOperationalAdvice({ dualPolicy: 'hold_on_conflict', llmScore: 90 });
    expect(a?.source).toBe('dual_conflict');
  });

  it('正常路径 → 按分数映射', () => {
    const a = resolveOperationalAdvice({ llmScore: 70 });
    expect(a?.source).toBe('score');
    expect(a?.label).toBe('偏多');
  });

  it('无分数 → null', () => {
    expect(resolveOperationalAdvice({})).toBeNull();
  });
});

describe('checkConsistency — 信号一致性', () => {
  it('全部偏多 → strong + 共识偏多', () => {
    const c = checkConsistency([
      { name: '技术', score: 70 }, { name: '基本', score: 65 },
      { name: '情绪', score: 60 }, { name: 'ETF', score: 62 },
    ]);
    expect(c.level).toBe('strong');
    expect(c.consensusDirection).toBe('bullish');
  });

  it('2:2 多空对峙 → weak（一致维度≤2）', () => {
    const c = checkConsistency([
      { name: '技术', score: 70 }, { name: '基本', score: 65 },
      { name: '情绪', score: 30 }, { name: 'ETF', score: 35 },
    ]);
    expect(c.level).toBe('weak');
  });
});
