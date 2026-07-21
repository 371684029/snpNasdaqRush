// Yahoo Finance 实时价格 — 美股指数/ETF/宏观锚定（零 LLM）
// User-Agent: SnpRush/0.1；6s 超时；DXY/10Y 可回落 FRED DEMO_KEY

const USER_AGENT = 'SnpRush/0.1';
const TIMEOUT_MS = 6_000;

export interface YahooLivePrice {
  symbol: string;
  price: number;        // 最新价
  previousClose: number; // 前收盘（用于计算涨跌幅）
  change: number;       // 涨跌幅 %
  timestamp: string;    // ISO datetime
  date: string;         // YYYY-MM-DD
}

interface YahooQuoteResult {
  symbol?: string;
  regularMarketPrice?: number;
  regularMarketPreviousClose?: number;
  previousClose?: number;
  regularMarketTime?: number;
  meta?: {
    symbol?: string;
    regularMarketPrice?: number;
    previousClose?: number;
    regularMarketTime?: number;
  };
}

interface YahooQuoteResponse {
  quoteResponse?: {
    result?: YahooQuoteResult[];
    error?: { description?: string } | null;
  };
}

interface FredObservationsResponse {
  observations?: Array<{
    date?: string;
    value?: string;
  }>;
}

/** 通过 Yahoo Finance Quote API 获取实时报价 */
export async function fetchQuote(symbol: string): Promise<YahooLivePrice | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[yahoo-live] ${symbol} quote API 返回 HTTP ${res.status}`);
      return null;
    }

    const body = await res.json() as YahooQuoteResponse;
    const result = body.quoteResponse?.result?.[0];
    if (!result) {
      console.warn(`[yahoo-live] ${symbol} 无报价数据`);
      return null;
    }

    // 兼容直字段与 meta 包裹两种形态
    const price = result.regularMarketPrice ?? result.meta?.regularMarketPrice;
    const previousClose =
      result.regularMarketPreviousClose
      ?? result.previousClose
      ?? result.meta?.previousClose;
    const regularMarketTime = result.regularMarketTime ?? result.meta?.regularMarketTime;

    if (price == null || !Number.isFinite(price) || price === 0) {
      console.warn(`[yahoo-live] ${symbol} 报价无效`);
      return null;
    }

    const ts = regularMarketTime ? new Date(regularMarketTime * 1000) : new Date();
    const chg = previousClose && Number.isFinite(previousClose) && previousClose !== 0
      ? ((price - previousClose) / previousClose) * 100
      : 0;

    return {
      symbol,
      price: Math.round(price * 100) / 100,
      previousClose: previousClose ?? price,
      change: Math.round(chg * 100) / 100,
      timestamp: ts.toISOString(),
      date: ts.toISOString().slice(0, 10),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[yahoo-live] ${symbol} 拉取失败: ${msg}`);
    return null;
  }
}

/** 简单 FRED 最新观测（DEMO_KEY；失败返回 null） */
async function fetchFredLatest(seriesId: string, asSymbol: string): Promise<YahooLivePrice | null> {
  try {
    const url =
      `https://api.stlouisfed.org/fred/series/observations`
      + `?series_id=${encodeURIComponent(seriesId)}`
      + `&api_key=DEMO_KEY&file_type=json&sort_order=desc&limit=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = await res.json() as FredObservationsResponse;
    const obs = body.observations?.[0];
    const raw = obs?.value;
    if (raw == null || raw === '.') return null;
    const price = Number(raw);
    if (!Number.isFinite(price) || price === 0) return null;
    const date = obs?.date ?? new Date().toISOString().slice(0, 10);
    return {
      symbol: asSymbol,
      price: Math.round(price * 100) / 100,
      previousClose: price,
      change: 0,
      timestamp: new Date().toISOString(),
      date,
    };
  } catch {
    return null;
  }
}

export async function fetchSpxLive(): Promise<YahooLivePrice | null> {
  return fetchQuote('^GSPC');
}

export async function fetchIxicLive(): Promise<YahooLivePrice | null> {
  return fetchQuote('^IXIC');
}

export async function fetchSpyLive(): Promise<YahooLivePrice | null> {
  return fetchQuote('SPY');
}

export async function fetchQqqLive(): Promise<YahooLivePrice | null> {
  return fetchQuote('QQQ');
}

export async function fetchVixLive(): Promise<YahooLivePrice | null> {
  return fetchQuote('^VIX');
}

/** DXY；失败则 FRED DTWEXBGS */
export async function fetchDxyLive(): Promise<YahooLivePrice | null> {
  const yahoo = await fetchQuote('DX-Y.NYB');
  if (yahoo) return yahoo;
  return fetchFredLatest('DTWEXBGS', 'DX-Y.NYB');
}

/** 10Y 美债收益率；失败则 FRED DGS10 */
export async function fetch10YLive(): Promise<YahooLivePrice | null> {
  const yahoo = await fetchQuote('^TNX');
  if (yahoo) return yahoo;
  return fetchFredLatest('DGS10', '^TNX');
}

/** 并行获取主要实时锚定 */
export async function fetchAllLiveEquity(): Promise<{
  spx: YahooLivePrice | null;
  ixic: YahooLivePrice | null;
  spy: YahooLivePrice | null;
  qqq: YahooLivePrice | null;
  vix: YahooLivePrice | null;
  dxy: YahooLivePrice | null;
  us10y: YahooLivePrice | null;
}> {
  const [spx, ixic, spy, qqq, vix, dxy, us10y] = await Promise.all([
    fetchSpxLive(),
    fetchIxicLive(),
    fetchSpyLive(),
    fetchQqqLive(),
    fetchVixLive(),
    fetchDxyLive(),
    fetch10YLive(),
  ]);
  return { spx, ixic, spy, qqq, vix, dxy, us10y };
}
