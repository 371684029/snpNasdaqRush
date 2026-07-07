// Yahoo Finance 历史指数 — ^GSPC 和 ^IXIC 日线收盘（无需 API Key）

import { addCalendarDays, todayDate } from '../utils/time.js';

const USER_AGENT = 'SnpRush/0.1 (index research CLI)';

interface YahooChartResult {
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      close?: Array<number | null>;
    }>;
  };
}

interface YahooChartResponse {
  chart?: {
    result?: YahooChartResult[];
    error?: { description?: string };
  };
}

export interface IndexHistoryRow {
  date: string;
  spxClose: number | null;
  ixicClose: number | null;
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
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ts * 1000));
  return parts;
}

async function fetchYahooIndexDailyClosesForSymbol(
  symbol: string,
  range: string,
  from: string,
  to: string,
): Promise<Map<string, number>> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`Yahoo Finance 请求失败 (${symbol}): HTTP ${res.status}`);
  }

  const body = await res.json() as YahooChartResponse;
  const err = body.chart?.error?.description;
  if (err) {
    throw new Error(`Yahoo Finance (${symbol}): ${err}`);
  }

  const result = body.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0];
  const closes = quote?.close ?? [];

  const rows = new Map<string, number>();
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close == null || !Number.isFinite(close) || close <= 0) continue;
    const date = yahooTimestampToDate(timestamps[i]);
    if (date < from || date > to) continue;
    rows.set(date, Math.round(close * 100) / 100);
  }
  return rows;
}

/**
 * 从 Yahoo Finance 拉取 ^GSPC 和 ^IXIC 日线收盘价。
 * @param calendarDays 需要的日历跨度（用于选择 range）
 * @param asOf 截止日期
 */
export async function fetchYahooIndexDailyCloses(
  calendarDays: number,
  asOf: string = todayDate(),
): Promise<IndexHistoryRow[]> {
  const range = rangeForDays(calendarDays);
  const from = addCalendarDays(asOf, -(calendarDays - 1));

  const [spxMap, ixicMap] = await Promise.all([
    fetchYahooIndexDailyClosesForSymbol('^GSPC', range, from, asOf),
    fetchYahooIndexDailyClosesForSymbol('^IXIC', range, from, asOf),
  ]);

  // Union of all dates from both symbols
  const allDates = new Set([...spxMap.keys(), ...ixicMap.keys()]);
  const rows: IndexHistoryRow[] = [];

  for (const date of allDates) {
    rows.push({
      date,
      spxClose: spxMap.get(date) ?? null,
      ixicClose: ixicMap.get(date) ?? null,
    });
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/** 解析 Yahoo JSON（供单测） */
export function parseYahooChartResponse(
  body: YahooChartResponse,
  from: string,
  to: string,
  symbol: '^GSPC' | '^IXIC' = '^GSPC',
): Map<string, number> {
  const result = body.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const rows = new Map<string, number>();
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close == null || !Number.isFinite(close) || close <= 0) continue;
    const date = yahooTimestampToDate(timestamps[i]);
    if (date < from || date > to) continue;
    rows.set(date, close);
  }
  return rows;
}
