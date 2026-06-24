// 搜索路由器
import { TavilyClient } from './tavily-client.js';
import { SearchCacheRepo } from '../db/search-cache.js';
import { getDb } from '../db/index.js';
import type { SearchResult, SearchOptions } from '../types/market.js';

export class SearchRouter {
  private tavily: TavilyClient;
  private cache: SearchCacheRepo;

  constructor(tavilyApiKey?: string) {
    this.tavily = new TavilyClient(tavilyApiKey);
    this.cache = new SearchCacheRepo(getDb());
  }

  async search(query: string, dataType: string, options?: Partial<SearchOptions>): Promise<SearchResult[]> {
    const numResults = options?.numResults ?? 5;
    const useCache = options?.useCache ?? true;

    const results: SearchResult[] = [];

    if (useCache) {
      const cached = this.cache.get(query, 'tavily');
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch { /* cache corrupt */ }
      }
    }

    const tavilyResults = await this.tavily.search(query, { engine: 'tavily', numResults });
    results.push(...tavilyResults);

    const deduped = this.deduplicate(results);

    if (useCache && deduped.length > 0) {
      this.cache.set(query, 'tavily', JSON.stringify(deduped));
    }

    return deduped;
  }

  async searchBatch(queries: Array<{ query: string; dataType: string }>, options?: Partial<SearchOptions>): Promise<Map<string, SearchResult[]>> {
    const results = new Map<string, SearchResult[]>();
    const promises = queries.map(async ({ query, dataType }) => {
      const searchResults = await this.search(query, dataType, options);
      results.set(query, searchResults);
    });
    await Promise.all(promises);
    return results;
  }

  private deduplicate(results: SearchResult[]): SearchResult[] {
    const seen = new Set<string>();
    return results.filter(r => {
      const key = r.url || r.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
