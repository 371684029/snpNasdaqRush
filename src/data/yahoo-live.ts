// Yahoo Finance 实时价格 — 零成本、零 LLM、直接 HTTP 获取
// 作为数据验证的 A 级锚定源，对齐 goldRush yahoo-live.ts

const USER_AGENT = 'SnpRush/0.1 (US index research CLI)';

export interface YahooLivePrice {
  symbol: string;
  price: number;
  previousClose: number;
  change: number;
  timestamp: string;
  date: string;
}

interface YahooQuoteResult {
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

async function fetchQuote(symbol: string): Promise<YahooLivePrice | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) { console.warn(`[yahoo-live] ${symbol} HTTP ${res.status}`); return null; }
    const body = await res.json() as YahooQuoteResponse;
    const result = body.quoteResponse?.result?.[0];
    if (!result?.meta) { console.warn(`[yahoo-live] ${symbol} 无报价`); return null; }
    const { regularMarketPrice, previousClose, regularMarketTime } = result.meta;
    if (regularMarketPrice == null || !Number.isFinite(regularMarketPrice)) {
      console.warn(`[yahoo-live] ${symbol} 报价无效`); return null;
    }
    const ts = regularMarketTime ? new Date(regularMarketTime * 1000) : new Date();
    const chg = previousClose ? ((regularMarketPrice - previousClose) / previousClose) * 100 : 0;
    return { symbol, price: Math.round(regularMarketPrice * 100) / 100, previousClose: previousClose ?? regularMarketPrice, change: Math.round(chg * 100) / 100, timestamp: ts.toISOString(), date: ts.toISOString().slice(0, 10) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[yahoo-live] ${symbol} 拉取失败: ${msg}`); return null;
  }
}

export async function fetchSpxLive(): Promise<YahooLivePrice | null> { return fetchQuote('^GSPC'); }
export async function fetchIxicLive(): Promise<YahooLivePrice | null> { return fetchQuote('^IXIC'); }
export async function fetchSpyLive(): Promise<YahooLivePrice | null> { return fetchQuote('SPY'); }
export async function fetchQqqLive(): Promise<YahooLivePrice | null> { return fetchQuote('QQQ'); }
export async function fetchVixLive(): Promise<YahooLivePrice | null> { return fetchQuote('^VIX'); }
export async function fetchDxyLive(): Promise<YahooLivePrice | null> { return fetchQuote('DX-Y.NYB'); }
export async function fetch10YLive(): Promise<YahooLivePrice | null> { return fetchQuote('^TNX'); }

export async function fetchAllIndexLive(): Promise<{
  spx: YahooLivePrice | null; ixic: YahooLivePrice | null;
  spy: YahooLivePrice | null; qqq: YahooLivePrice | null;
  vix: YahooLivePrice | null; dxy: YahooLivePrice | null; us10y: YahooLivePrice | null;
}> {
  const [spx, ixic, spy, qqq, vix, dxy, us10y] = await Promise.all([
    fetchSpxLive(), fetchIxicLive(), fetchSpyLive(), fetchQqqLive(),
    fetchVixLive(), fetchDxyLive(), fetch10YLive(),
  ]);
  return { spx, ixic, spy, qqq, vix, dxy, us10y };
}
