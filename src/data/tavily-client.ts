// Tavily API 封装 — 金融搜索客户端
import type { SearchResult } from '../types/market.js';

/**
 * 通过 Tavily API 搜索，返回 SearchResult 数组。
 * 调用方负责确保 apiKey 非空。
 */
export async function searchTavily(
  query: string,
  apiKey: string,
  numResults: number = 5,
): Promise<SearchResult[]> {
  const { tavily } = await import('@tavily/core');
  const client = tavily({ apiKey });

  const response = await client.search(query, {
    maxResults: numResults,
    searchDepth: 'basic',
  });

  return (response.results ?? []).map(r => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.content ?? '',
    engine: 'tavily' as const,
    publishedDate: r.publishedDate ?? undefined,
  }));
}
