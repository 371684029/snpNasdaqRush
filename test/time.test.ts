import { describe, it, expect } from 'vitest';
import { todayDate, getTradingTime } from '../src/utils/time';

describe('todayDate — 按 Asia/Shanghai 日历日（不受运行机器时区影响）', () => {
  it('UTC 临近午夜的时刻应返回上海当日（次日）', () => {
    // 2026-06-23T17:30:00Z = 上海 2026-06-24 01:30
    expect(todayDate(new Date('2026-06-23T17:30:00Z'))).toBe('2026-06-24');
  });

  it('UTC 上午时刻应返回上海当日', () => {
    // 2026-06-23T10:00:00Z = 上海 2026-06-23 18:00
    expect(todayDate(new Date('2026-06-23T10:00:00Z'))).toBe('2026-06-23');
  });
});

describe('getTradingTime — 按美东时间（America/New_York）+ 自动夏令时', () => {
  it('夏令时 09:30 ET 应为盘中（13:30Z）', () => {
    // 2026-06-23(周二) EDT(UTC-4): 13:30Z = 09:30 ET
    expect(getTradingTime(new Date('2026-06-23T13:30:00Z')).session).toBe('day');
  });

  it('冬令时 09:30 ET 应为盘中（14:30Z）—— 验证自动夏令时切换', () => {
    // 2026-01-05(周一) EST(UTC-5): 14:30Z = 09:30 ET
    expect(getTradingTime(new Date('2026-01-05T14:30:00Z')).session).toBe('day');
  });

  it('09:00 ET 应为盘前', () => {
    // 13:00Z = 09:00 EDT
    expect(getTradingTime(new Date('2026-06-23T13:00:00Z')).session).toBe('pre_market');
  });

  it('09:29 ET 仍为盘前（开盘边界）', () => {
    expect(getTradingTime(new Date('2026-06-23T13:29:00Z')).session).toBe('pre_market');
  });

  it('16:30 ET 应为盘后', () => {
    // 20:30Z = 16:30 EDT
    expect(getTradingTime(new Date('2026-06-23T20:30:00Z')).session).toBe('after_hours');
  });

  it('周末应判定为休市', () => {
    // 2026-06-20(周六) 15:00Z = 11:00 ET
    const info = getTradingTime(new Date('2026-06-20T15:00:00Z'));
    expect(info.session).toBe('closed');
    expect(info.isTradingDay).toBe(false);
  });
});
