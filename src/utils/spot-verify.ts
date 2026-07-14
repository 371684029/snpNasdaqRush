// 搜索 snippet 启发式抽价 — Validator 独立 spot-check（无额外 LLM）
// 对齐 goldRush spot-verify.ts，适配美股指数

import { gradeSource } from './source-rank.js';
import type { SearchResult, ValidationSource } from '../types/market.js';

const SPX_MIN = 3000;
const SPX_MAX = 20000;
const IXIC_MIN = 8000;
const IXIC_MAX = 50000;
const VIX_MIN = 8;
const VIX_MAX = 80;

/** 从 Tavily 结果提取 S&P 500 候选价 */
export function extractSpxPricesFromSearch(results: SearchResult[]): ValidationSource[] {
  const out: ValidationSource[] = [];
  const seen = new Set<number>();
  for (const r of results) {
    const text = `${r.title} ${r.snippet}`;
    const patterns = [
      /S&P\s*500[^\d]*([\d,]+\.?\d*)/gi,
      /SPX[^\d]*([\d,]+\.?\d*)/gi,
      /标普500[^\d]*([\d,]+\.?\d*)/g,
      /\$?GSPC[^\d]*([\d,]+\.?\d*)/gi,
    ];
    for (const re of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) != null) {
        const val = parseFloat(m[1].replace(/,/g, ''));
        if (!Number.isFinite(val) || val < SPX_MIN || val > SPX_MAX) continue;
        const key = Math.round(val);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ value: val, source: r.title.slice(0, 48) || r.url, grade: r.sourceGrade ?? gradeSource(r.url), timestamp: new Date().toISOString() });
      }
    }
  }
  return out;
}

/** 从 Tavily 结果提取 NASDAQ 候选价 */
export function extractIxicPricesFromSearch(results: SearchResult[]): ValidationSource[] {
  const out: ValidationSource[] = [];
  const seen = new Set<number>();
  for (const r of results) {
    const text = `${r.title} ${r.snippet}`;
    const patterns = [
      /NASDAQ[^\d]*([\d,]+\.?\d*)/gi,
      /IXIC[^\d]*([\d,]+\.?\d*)/gi,
      /纳斯达克[^\d]*([\d,]+\.?\d*)/g,
      /纳指[^\d]*([\d,]+\.?\d*)/g,
    ];
    for (const re of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) != null) {
        const val = parseFloat(m[1].replace(/,/g, ''));
        if (!Number.isFinite(val) || val < IXIC_MIN || val > IXIC_MAX) continue;
        const key = Math.round(val);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ value: val, source: r.title.slice(0, 48) || r.url, grade: r.sourceGrade ?? gradeSource(r.url), timestamp: new Date().toISOString() });
      }
    }
  }
  return out;
}

/** 从 Tavily 结果提取 VIX 候选价 */
export function extractVixPricesFromSearch(results: SearchResult[]): ValidationSource[] {
  const out: ValidationSource[] = [];
  const seen = new Set<number>();
  for (const r of results) {
    const text = `${r.title} ${r.snippet}`;
    const patterns = [
      /VIX[^\d]*([\d.]+)/gi,
      /恐慌指数[^\d]*([\d.]+)/g,
      /CBOE[^\d]*([\d.]+)/gi,
    ];
    for (const re of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) != null) {
        const val = parseFloat(m[1].replace(/,/g, ''));
        if (!Number.isFinite(val) || val < VIX_MIN || val > VIX_MAX) continue;
        const key = Math.round(val * 10);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ value: val, source: r.title.slice(0, 48) || r.url, grade: r.sourceGrade ?? gradeSource(r.url), timestamp: new Date().toISOString() });
      }
    }
  }
  return out;
}

/** 合并验证源，跳过重复项（% 容差） */
export function mergeValidationSources(existing: ValidationSource[], extra: ValidationSource[], tolerancePct = 0.05): ValidationSource[] {
  const merged = [...existing];
  for (const e of extra) {
    if (typeof e.value !== 'number') continue;
    const dup = merged.some(m => {
      if (typeof m.value !== 'number' || typeof e.value !== 'number') return false;
      const avg = (m.value + e.value) / 2;
      return avg > 0 && Math.abs(m.value - e.value) / avg * 100 < tolerancePct;
    });
    if (!dup) merged.push(e);
  }
  return merged;
}

/** 是否已有足够多源 */
export function needsSpotCheck(sources: ValidationSource[], minSources = 2): boolean {
  return sources.filter(s => typeof s.value === 'number').length < minSources;
}
