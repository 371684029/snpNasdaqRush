// 搜索缓存
import Database from 'better-sqlite3';
import crypto from 'node:crypto';

export class SearchCacheRepo {
  constructor(private db: Database.Database) {}

  get(query: string, engine: string): string | null {
    const hash = this.hash(query + engine);
    const row = this.db.prepare(`
      SELECT results FROM search_cache
      WHERE query_hash = ? AND expires_at > datetime('now')
    `).get(hash) as { results: string } | undefined;
    return row?.results ?? null;
  }

  set(query: string, engine: string, results: string, ttlMinutes: number = 5): void {
    const hash = this.hash(query + engine);
    this.db.prepare(`
      INSERT INTO search_cache (query_hash, query, engine, results, expires_at)
      VALUES (?, ?, ?, ?, datetime('now', '+' || ? || ' minutes'))
      ON CONFLICT(query_hash) DO UPDATE SET
        results = excluded.results, expires_at = excluded.expires_at
    `).run(hash, query, engine, results, ttlMinutes);
  }

  private hash(input: string): string {
    return crypto.createHash('md5').update(input).digest('hex');
  }
}
