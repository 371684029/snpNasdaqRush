// 交易时间判断 — 美股市场

import type { TradingTimeInfo, TradingSession } from '../types/market.js';

/** 指定时区下的日历分量 */
interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0=周日 ... 6=周六
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * 用 Intl 取得给定时刻在指定时区下的日历分量。
 * 不依赖运行机器的本地时区，且自动处理夏令时（如 America/New_York）。
 */
function getZonedParts(timeZone: string, now: Date = new Date()): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(now);

  const get = (type: string): string => parts.find(p => p.type === type)?.value ?? '';
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0; // 部分运行时把午夜渲染为 24 时

  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    hour,
    minute: parseInt(get('minute'), 10),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  };
}

/**
 * 判断当前是否为美股交易时间（按美东时间 America/New_York，自动处理夏令时）。
 * 盘前 04:00~09:30 / 盘中 09:30~16:00 / 盘后 16:00~20:00。
 * 支持注入 now 便于测试。
 */
export function getTradingTime(now: Date = new Date()): TradingTimeInfo {
  const { weekday: day, hour, minute } = getZonedParts('America/New_York', now);

  const isTradingDay = day >= 1 && day <= 5;

  let session: TradingSession = 'closed';
  let description = '';

  if (!isTradingDay) {
    session = 'closed';
    description = day === 6 ? '周六休市' : '周日休市';
  } else if (hour >= 4 && (hour < 9 || (hour === 9 && minute < 30))) {
    // 盘前 04:00 ~ 09:30
    session = 'pre_market';
    description = '盘前交易';
  } else if ((hour === 9 && minute >= 30) || (hour >= 10 && hour < 16)) {
    // 盘中 09:30 ~ 16:00
    session = 'day';
    description = '盘中交易中';
  } else if (hour >= 16 && hour < 20) {
    // 盘后 16:00 ~ 20:00
    session = 'after_hours';
    description = '盘后交易';
  } else {
    session = 'closed';
    description = '休市';
  }

  return { session, description, isTradingDay };
}

/** 格式化当前时间 (北京时间) */
export function formatNow(): string {
  const now = new Date();
  return now.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).replace(/\//g, '-');
}

/** 格式化美东时间 */
export function formatNowET(): string {
  const now = new Date();
  return now.toLocaleString('zh-CN', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).replace(/\//g, '-');
}

/** 获取今日日期 YYYY-MM-DD（按北京时间 Asia/Shanghai 日历日，不受运行机器时区影响） */
export function todayDate(now: Date = new Date()): string {
  const { year, month, day } = getZonedParts('Asia/Shanghai', now);
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}
