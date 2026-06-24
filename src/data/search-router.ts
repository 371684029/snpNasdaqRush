// 搜索路由器 — Tavily 优先，无 API key 时返回空结果
import { SearchCacheRepo } from '../db/search-cache.js';
import { getDb } from '../db/index.js';
import { getConfig } from '../utils/config.js';
import type { SearchResult } from '../types/market.js';

interface BatchSearchItem {
  query: string;
  dataType: string;
}

interface BatchSearchOptions {
  numResults: number;
}

export class SearchRouter {
  private cache: SearchCacheRepo;

  constructor(private tavilyApiKey: string) {
    this.cache = new SearchCacheRepo(getDb());
  }

  /**
   * 批量搜索。有 Tavily key 则调用 Tavily，否则返回空结果集，
   * 由 DataCollectorAgent 直接依赖 LLM 知识回答。
   */
  async searchBatch(
    searches: BatchSearchItem[],
    options: BatchSearchOptions,
  ): Promise<Map<string, SearchResult[]>> {
    const results = new Map<string, SearchResult[]>();
    const config = getConfig();

    for (const { query } of searches) {
      const cached = this.cache.get(query, 'tavily');
      if (cached) {
        try {
          results.set(query, JSON.parse(cached) as SearchResult[]);
          continue;
        } catch {
          // 缓存损坏，重新查询
        }
      }

      if (this.tavilyApiKey) {
        try {
          const { searchTavily } = await import('./tavily-client.js');
          const res = await searchTavily(query, this.tavilyApiKey, options.numResults);
          this.cache.set(query, 'tavily', JSON.stringify(res), config.search.cacheMinutes);
          results.set(query, res);
        } catch (err) {
          console.error(`  ⚠️ Tavily 搜索失败 "${query}":`, err instanceof Error ? err.message : String(err));
          results.set(query, []);
        }
      } else {
        results.set(query, []);
      }
    }

    return results;
  }
}
