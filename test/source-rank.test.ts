import { describe, it, expect } from 'vitest';
import { gradeSource, checkFreshness } from '../src/utils/source-rank';

describe('gradeSource — 来源分级', () => {
  it('权威来源识别为 A 级', () => {
    expect(gradeSource('S&P Global')).toBe('A');
    expect(gradeSource('NASDAQ')).toBe('A');
    expect(gradeSource('Federal Reserve')).toBe('A');
  });

  it('未知来源默认 B 级（对齐 goldRush）', () => {
    expect(gradeSource('某不知名博客')).toBe('B');
  });

  it('可信财经媒体识别为 B 级', () => {
    expect(gradeSource('CNBC')).toBe('B');
    expect(gradeSource('Yahoo Finance')).toBe('B');
  });

});

describe('checkFreshness — 时效性与非法时间戳防御', () => {
  it('缺失时间戳应判定为不新鲜并给出警告', () => {
    const r = checkFreshness(undefined);
    expect(r.fresh).toBe(false);
    expect(r.warning).toBeTruthy();
  });

  it('非法时间戳应判定为不新鲜', () => {
    const r = checkFreshness('not-a-date');
    expect(r.fresh).toBe(false);
    expect(r.warning).toBeTruthy();
  });

  it('刚刚的时间应判定为新鲜', () => {
    expect(checkFreshness(new Date().toISOString()).fresh).toBe(true);
  });

  it('超过 24 小时的旧时间应判定为不新鲜', () => {
    const old = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
    expect(checkFreshness(old).fresh).toBe(false);
  });
});
