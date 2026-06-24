// Tavily 搜索客户端
import type { SearchResult, SearchOptions } from '../types/market.js';

export class TavilyClient {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.TAVILY_API_KEY ?? '';
  }

  async search(query: string, options?: Partial<SearchOptions>): Promise<SearchResult[]> {
    if (!this.apiKey) {
      return this.fallbackSearch(query);
    }

    try {
      const numResults = options?.numResults ?? 5;
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: this.apiKey,
          query,
          search_depth: 'basic',
          max_results: numResults,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        console.error(`  ⚠️ Tavily search failed (${res.status}), using fallback`);
        return this.fallbackSearch(query);
      }

      const data = await res.json() as {
        results?: Array<{
          title: string;
          url: string;
          content: string;
          published_date?: string;
        }>;
      };

      return (data.results || []).map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.content?.slice(0, 500) ?? '',
        engine: 'tavily' as const,
        publishedDate: r.published_date,
      }));
    } catch (err) {
      console.error(`  ⚠️ Tavily search error: ${err instanceof Error ? err.message : String(err)}, using fallback`);
      return this.fallbackSearch(query);
    }
  }

  /** 当 Tavily 不可用时的简单降级方案 */
  private async fallbackSearch(query: string): Promise<SearchResult[]> {
    try {
      const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return [];
      const data = await res.json() as { AbstractText?: string; Results?: Array<{ Text: string; FirstURL: string }> };
      const results: SearchResult[] = [];
      if (data.AbstractText) {
        results.push({ title: query, url: '', snippet: data.AbstractText.slice(0, 500), engine: 'tavily' });
      }
      for (const r of data.Results ?? []) {
        results.push({ title: r.Text, url: r.FirstURL, snippet: r.Text.slice(0, 500), engine: 'tavily' });
      }
      return results.slice(0, 5);
    } catch {
      return [];
    }
  }
}
