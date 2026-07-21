// Yahoo Finance 指数日线历史 — SPX / IXIC（无需 API Key）

import { todayDate } from '../utils/time.js';

const USER_AGENT = 'SnpRush/0.1';

export interface YahooDailyBar {
  date: string;
  close: number;
  high?: number | null;
  low?: number | null;
  volume?: number | null;
}

interface YahooChartResult {
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      close?: Array<number | null>;
      high?: Array<number | null>;
      low?: Array<number | null>;
      volume?: Array<number | null>;
    }>;
  };
}

interface YahooChartResponse {
  chart?: {
    result?: YahooChartResult[];
    error?: { description?: string };
  };
}

/** 本地日历日加减（YYYY-MM-DD），避免循环依赖未导出时的问题 */
function addCalendarDaysLocal(dateStr: string, delta: number): string {
  const base = new Date(`${dateStr}T12:00:00-05:00`);
  base.setUTCDate(base.getUTCDate() + delta);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(base);
  return parts;
}

/** Yahoo range 参数 */
function rangeForDays(calendarDays: number): string {
  if (calendarDays <= 35) return '1mo';
  if (calendarDays <= 95) return '3mo';
  if (calendarDays <= 185) return '6mo';
  return '1y';
}

/** Unix 秒 → YYYY-MM-DD（按 America/New_York 交易日历） */
export function yahooTimestampToDate(ts: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ts * 1000));
}

/**
 * 从 Yahoo Finance 拉取任意标的日线收盘。
 * @param symbol Yahoo 代码，如 ^GSPC / ^IXIC
 * @param calendarDays 需要的日历跨度（用于选择 range）
 * @param asOf 截止日期（美东日历日）
 */
export async function fetchYahooDailyCloses(
  symbol: string,
  calendarDays: number,
  asOf: string = todayDate(),
): Promise<YahooDailyBar[]> {
  const range = rangeForDays(calendarDays);
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
    + `?interval=1d&range=${range}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Yahoo Finance 请求失败: HTTP ${res.status}`);
  }

  const body = await res.json() as YahooChartResponse;
  const err = body.chart?.error?.description;
  if (err) {
    throw new Error(`Yahoo Finance: ${err}`);
  }

  return parseYahooChartResponse(body, addCalendarDaysLocal(asOf, -(calendarDays - 1)), asOf);
}

/** 解析 Yahoo JSON（供单测） */
export function parseYahooChartResponse(
  body: YahooChartResponse,
  from: string,
  to: string,
): YahooDailyBar[] {
  const result = body.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0];
  const closes = quote?.close ?? [];
  const highs = quote?.high ?? [];
  const lows = quote?.low ?? [];
  const volumes = quote?.volume ?? [];
  const rows: YahooDailyBar[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close == null || !Number.isFinite(close) || close <= 0) continue;
    const date = yahooTimestampToDate(timestamps[i]);
    if (date < from || date > to) continue;
    rows.push({
      date,
      close: Math.round(close * 100) / 100,
      high: highs[i] ?? null,
      low: lows[i] ?? null,
      volume: volumes[i] ?? null,
    });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchYahooSpxHistory(
  calendarDays: number,
  asOf: string = todayDate(),
): Promise<YahooDailyBar[]> {
  return fetchYahooDailyCloses('^GSPC', calendarDays, asOf);
}

export async function fetchYahooIxicHistory(
  calendarDays: number,
  asOf: string = todayDate(),
): Promise<YahooDailyBar[]> {
  return fetchYahooDailyCloses('^IXIC', calendarDays, asOf);
}
