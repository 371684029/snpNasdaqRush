// 交易时间判断 — 美股市场

import type { TradingTimeInfo, TradingSession } from '../types/market.js';

/**
 * 判断当前是否为美股交易时间
 * 美股：9:30-16:00 ET (常规) / 盘前 4:00-9:30 / 盘后 16:00-20:00
 */
export function getTradingTime(): TradingTimeInfo {
  const now = new Date();

  // 转为美东时间 (UTC-5, 夏令时 UTC-4)
  const etOffset = -5 * 60 * 60 * 1000;
  const etTime = new Date(now.getTime() + etOffset + now.getTimezoneOffset() * 60 * 1000);
  // 简单夏令时判断：3月第二个周日~11月第一个周日为夏令时
  const isEDT = isDaylightTime(etTime);
  if (isEDT) {
    etTime.setHours(etTime.getHours() + 1);
  }

  const day = etTime.getDay(); // 0=周日
  const hour = etTime.getHours();
  const minute = etTime.getMinutes();

  const isTradingDay = day >= 1 && day <= 5;

  let session: TradingSession = 'closed';
  let description = '';

  if (!isTradingDay) {
    session = 'closed';
    description = day === 6 ? '周六休市' : '周日休市';
  } else if ((hour >= 9 && (hour > 9 || minute >= 30)) && hour < 16) {
    session = 'day';
    description = '盘中交易中';
  } else if (hour >= 4 && hour < 9) {
    session = 'pre_market';
    description = '盘前交易';
  } else if (hour >= 16 && hour < 20) {
    session = 'after_hours';
    description = '盘后交易';
  } else {
    session = 'closed';
    description = '休市';
  }

  return { session, description, isTradingDay };
}

/** 简单夏令时判断 */
function isDaylightTime(date: Date): boolean {
  const year = date.getFullYear();
  // 3月第二个周日 2:00 AM
  const march = new Date(year, 2, 1);
  const marchSecondSunday = getNthSunday(march, 2);
  // 11月第一个周日 2:00 AM
  const nov = new Date(year, 10, 1);
  const novFirstSunday = getNthSunday(nov, 1);

  return date >= marchSecondSunday && date < novFirstSunday;
}

function getNthSunday(date: Date, n: number): Date {
  const day = date.getDay();
  const diff = day === 0 ? 0 : 7 - day;
  const firstSunday = new Date(date);
  firstSunday.setDate(date.getDate() + diff);
  firstSunday.setHours(2, 0, 0, 0);
  if (n > 1) {
    firstSunday.setDate(firstSunday.getDate() + (n - 1) * 7);
  }
  return firstSunday;
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

/** 获取今日日期 YYYY-MM-DD (北京时间) */
export function todayDate(): string {
  const now = new Date();
  const cst = new Date(now.getTime() + 8 * 60 * 60 * 1000 + now.getTimezoneOffset() * 60 * 1000);
  return cst.toISOString().slice(0, 10);
}
