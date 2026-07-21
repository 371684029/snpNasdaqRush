// 搜索原文存档 — 审计追溯 LLM 提取前的 Tavily 片段（30 天滚动）

import fs from 'node:fs';
import path from 'node:path';
import type { SearchResult } from '../types/market.js';

export interface SearchRawArchiveEntry {
  query: string;
  dataType?: string;
  results: Array<{
    title: string;
    url: string;
    snippet: string;
    sourceGrade?: string;
    publishedDate?: string;
  }>;
}

export interface SearchRawArchiveFile {
  timestamp: string;
  date: string;
  queries: SearchRawArchiveEntry[];
}

const DEFAULT_DIR = path.join('docs', 'search-raw');
const RETAIN_DAYS = 30;

/** 将一批搜索结果写入 docs/search-raw/YYYY-MM-DD.json（追加合并同日） */
export function archiveSearchRaw(
  queries: SearchRawArchiveEntry[],
  opts?: { dir?: string; date?: string; now?: Date },
): string | null {
  if (!queries.length) return null;
  const dir = opts?.dir ?? DEFAULT_DIR;
  const now = opts?.now ?? new Date();
  const date = opts?.date ?? now.toISOString().slice(0, 10);

  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${date}.json`);
    let existing: SearchRawArchiveFile | null = null;
    if (fs.existsSync(filePath)) {
      try {
        existing = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SearchRawArchiveFile;
      } catch {
        existing = null;
      }
    }
    const payload: SearchRawArchiveFile = {
      timestamp: now.toISOString(),
      date,
      queries: [...(existing?.queries ?? []), ...queries],
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    purgeOldArchives(dir, RETAIN_DAYS, now);
    return filePath;
  } catch (err) {
    console.warn('  ⚠️ 搜索原文存档失败:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** 从 SearchRouter 批结果转存档条目 */
export function toArchiveEntries(
  items: Array<{ query: string; dataType?: string; results: SearchResult[] }>,
): SearchRawArchiveEntry[] {
  return items.map((it) => ({
    query: it.query,
    dataType: it.dataType,
    results: (it.results ?? []).slice(0, 8).map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: (r.snippet ?? '').slice(0, 800),
      sourceGrade: r.sourceGrade,
      publishedDate: r.publishedDate,
    })),
  }));
}

function purgeOldArchives(dir: string, retainDays: number, now: Date): void {
  try {
    if (!fs.existsSync(dir)) return;
    const cutoff = new Date(now);
    cutoff.setUTCDate(cutoff.getUTCDate() - retainDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    for (const name of fs.readdirSync(dir)) {
      if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
      const d = name.replace('.json', '');
      if (d < cutoffStr) {
        try {
          fs.unlinkSync(path.join(dir, name));
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}
