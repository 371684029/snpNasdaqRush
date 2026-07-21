// 历史预测对错统计 — 基于 analysis_reports + index_prices（spxClose）
//
// 写入 docs/snprush-stats-latest.json 供 Web 展示；日报 MD 嵌入摘要表

import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { ReportsRepo } from '../db/reports.js';
import { IndexPricesRepo } from '../db/index-prices.js';
import { SCORE_BUCKETS } from './score-buckets.js';
import {
  DUAL_CONFLICT_THRESHOLD,
  predictDirectionFromScore,
} from './dual-score.js';

export interface PredictionRecentRow {
  date: string;
  llmScore: number;
  quantScore: number | null;
  direction: string;
  pred: 'up' | 'down' | 'flat';
  actual5dPct: number | null;
  hit: boolean | null;
  status: 'hit' | 'miss' | 'pending' | 'flat';
}

export interface PredictionBucketStat {
  range: string;
  sample: number;
  upRate: number;
  avgReturn: number;
}

export interface PredictionTrackStats {
  asOf: string;
  windowDays: number;
  sampleEligible: number;
  llm: { hits: number; total: number; hitRate: number | null };
  quant: { hits: number; total: number; hitRate: number | null };
  highScoreUpRate: number | null;
  highScoreN: number;
  lowScoreUpRate: number | null;
  lowScoreN: number;
  conflictDays: number;
  conflictFollowQuantHits: number;
  conflictFollowLlmHits: number;
  buckets: PredictionBucketStat[];
  recent: PredictionRecentRow[];
  summary: string;
}

function validClose(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v) && v > 0;
}

function extractQuantScore(reportJson: string): number | null {
  try {
    const parsed = JSON.parse(reportJson) as {
      overall?: { quantScore?: number };
      quantScore?: number;
    };
    const q = parsed.overall?.quantScore ?? parsed.quantScore;
    return q != null && Number.isFinite(q) ? q : null;
  } catch {
    return null;
  }
}

function futureReturn(
  prices: IndexPricesRepo,
  date: string,
  T: number,
): number | null {
  const cur = prices.getByDate(date);
  if (!validClose(cur?.spxClose)) return null;
  const after = prices.getAfter(date, T).filter(p => validClose(p.spxClose));
  if (after.length < Math.min(T, 3)) return null;
  const fut = after.length >= T ? after[T - 1] : after[after.length - 1];
  if (!validClose(fut.spxClose)) return null;
  return ((fut.spxClose - cur!.spxClose!) / cur!.spxClose!) * 100;
}

/** 内联双重命中统计（CalibrationRepo 可能尚无 computeDualTrackHitStats） */
function computeDualTrackInline(
  reports: Array<{ date: string; overallScore: number; reportJson: string }>,
  prices: IndexPricesRepo,
  T: number,
): {
  llmHits: number;
  llmTotal: number;
  quantHits: number;
  quantTotal: number;
  conflictDays: number;
  conflictFollowQuantHits: number;
  conflictFollowLlmHits: number;
} {
  let llmHits = 0;
  let llmTotal = 0;
  let quantHits = 0;
  let quantTotal = 0;
  let conflictDays = 0;
  let conflictFollowQuantHits = 0;
  let conflictFollowLlmHits = 0;

  for (const r of reports) {
    const ret = futureReturn(prices, r.date, T);
    if (ret == null || Math.abs(ret) <= 0.1) continue;

    const actualUp = ret > 0.1;
    const actualDown = ret < -0.1;
    const llmPred = predictDirectionFromScore(r.overallScore);
    if (llmPred) {
      llmTotal++;
      const hit = (llmPred === 'up' && actualUp) || (llmPred === 'down' && actualDown);
      if (hit) llmHits++;
    }

    const quantScore = extractQuantScore(r.reportJson);
    const qPred = quantScore != null ? predictDirectionFromScore(quantScore) : null;
    if (qPred) {
      quantTotal++;
      const hit = (qPred === 'up' && actualUp) || (qPred === 'down' && actualDown);
      if (hit) quantHits++;
    }

    if (quantScore != null && Math.abs(r.overallScore - quantScore) > DUAL_CONFLICT_THRESHOLD) {
      conflictDays++;
      if (qPred) {
        const qHit = (qPred === 'up' && actualUp) || (qPred === 'down' && actualDown);
        if (qHit) conflictFollowQuantHits++;
      }
      if (llmPred) {
        const lHit = (llmPred === 'up' && actualUp) || (llmPred === 'down' && actualDown);
        if (lHit) conflictFollowLlmHits++;
      }
    }
  }

  return {
    llmHits,
    llmTotal,
    quantHits,
    quantTotal,
    conflictDays,
    conflictFollowQuantHits,
    conflictFollowLlmHits,
  };
}

export function buildPredictionTrackStats(
  db: Database.Database,
  windowDays = 90,
  T = 5,
): PredictionTrackStats {
  const reports = new ReportsRepo(db);
  const prices = new IndexPricesRepo(db);

  const eligible = reports.getRecent(windowDays).filter(r => {
    const p = prices.getByDate(r.date);
    return validClose(p?.spxClose);
  });

  const dual = computeDualTrackInline(eligible, prices, T);
  const llmHitRate = dual.llmTotal > 0 ? dual.llmHits / dual.llmTotal : null;
  const quantHitRate = dual.quantTotal > 0 ? dual.quantHits / dual.quantTotal : null;

  const buckets: PredictionBucketStat[] = [];
  for (const { range, min, max } of SCORE_BUCKETS) {
    const isLast = max === 100;
    const matching = eligible.filter(r =>
      r.overallScore >= min && (isLast ? r.overallScore <= max : r.overallScore < max),
    );
    let up = 0;
    let sum = 0;
    let n = 0;
    for (const r of matching) {
      const ret = futureReturn(prices, r.date, T);
      if (ret == null) continue;
      n++;
      sum += ret;
      if (ret > 0) up++;
    }
    if (n === 0) continue;
    buckets.push({
      range,
      sample: n,
      upRate: Math.round((up / n) * 1000) / 10,
      avgReturn: Math.round((sum / n) * 100) / 100,
    });
  }

  let highUp = 0, highN = 0, lowUp = 0, lowN = 0;
  for (const r of eligible) {
    const ret = futureReturn(prices, r.date, T);
    if (ret == null) continue;
    if (r.overallScore >= 60) {
      highN++;
      if (ret > 0) highUp++;
    }
    if (r.overallScore <= 40) {
      lowN++;
      if (ret > 0) lowUp++;
    }
  }

  const recent: PredictionRecentRow[] = [];
  for (const r of eligible.slice(0, 14)) {
    const ret = futureReturn(prices, r.date, T);
    const predDir = predictDirectionFromScore(r.overallScore);
    let pred: PredictionRecentRow['pred'] = 'flat';
    if (predDir === 'up') pred = 'up';
    else if (predDir === 'down') pred = 'down';

    let status: PredictionRecentRow['status'] = 'pending';
    let hit: boolean | null = null;
    if (ret == null) {
      status = 'pending';
    } else if (Math.abs(ret) <= 0.1 || pred === 'flat') {
      status = 'flat';
      hit = null;
    } else {
      const actualUp = ret > 0.1;
      const actualDown = ret < -0.1;
      hit = (pred === 'up' && actualUp) || (pred === 'down' && actualDown);
      status = hit ? 'hit' : 'miss';
    }

    recent.push({
      date: r.date,
      llmScore: r.overallScore,
      quantScore: extractQuantScore(r.reportJson),
      direction: r.direction,
      pred,
      actual5dPct: ret != null ? Math.round(ret * 100) / 100 : null,
      hit,
      status,
    });
  }

  const parts: string[] = [];
  if (llmHitRate != null) {
    parts.push(`LLM 方向命中 ${(llmHitRate * 100).toFixed(0)}%（${dual.llmHits}/${dual.llmTotal}）`);
  } else {
    parts.push('LLM 方向样本不足');
  }
  if (quantHitRate != null) {
    parts.push(`量化命中 ${(quantHitRate * 100).toFixed(0)}%（${dual.quantHits}/${dual.quantTotal}）`);
  } else {
    parts.push('量化样本待积累');
  }
  if (highN >= 3) {
    parts.push(`高分段(≥60) 5日涨 ${(highUp / highN * 100).toFixed(0)}%`);
  }
  if (lowN >= 3) {
    parts.push(`低分段(≤40) 5日涨 ${(lowUp / lowN * 100).toFixed(0)}%`);
  }
  if (dual.conflictDays > 0) {
    parts.push(`冲突日 ${dual.conflictDays}（跟量化 ${dual.conflictFollowQuantHits} / 跟LLM ${dual.conflictFollowLlmHits}）`);
  }

  return {
    asOf: new Date().toISOString().slice(0, 10),
    windowDays,
    sampleEligible: eligible.length,
    llm: {
      hits: dual.llmHits,
      total: dual.llmTotal,
      hitRate: llmHitRate != null ? Math.round(llmHitRate * 1000) / 10 : null,
    },
    quant: {
      hits: dual.quantHits,
      total: dual.quantTotal,
      hitRate: quantHitRate != null ? Math.round(quantHitRate * 1000) / 10 : null,
    },
    highScoreUpRate: highN >= 1 ? Math.round((highUp / highN) * 1000) / 10 : null,
    highScoreN: highN,
    lowScoreUpRate: lowN >= 1 ? Math.round((lowUp / lowN) * 1000) / 10 : null,
    lowScoreN: lowN,
    conflictDays: dual.conflictDays,
    conflictFollowQuantHits: dual.conflictFollowQuantHits,
    conflictFollowLlmHits: dual.conflictFollowLlmHits,
    buckets,
    recent,
    summary: parts.join(' · '),
  };
}

/** 写入 docs/snprush-stats-latest.json */
export function writePredictionTrackJson(
  stats: PredictionTrackStats,
  projectRoot: string = process.cwd(),
): string {
  const docsDir = path.join(projectRoot, 'docs');
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
  const out = path.join(docsDir, 'snprush-stats-latest.json');
  fs.writeFileSync(out, JSON.stringify(stats, null, 2), 'utf-8');
  return out;
}

export function formatPredictionTrackConsole(stats: PredictionTrackStats, indent = '  '): string {
  const lines = [
    `${indent}📊 历史预测对错（近 ${stats.windowDays} 日 · 5 日标签 · SPX）`,
    `${indent}  ${stats.summary}`,
    `${indent}  样本报告 ${stats.sampleEligible} 条`,
  ];
  if (stats.recent.length) {
    lines.push(`${indent}  近况：`);
    for (const r of stats.recent.slice(0, 8)) {
      const mark = r.status === 'hit' ? '✅' : r.status === 'miss' ? '❌' : r.status === 'flat' ? '➖' : '⏳';
      const ret = r.actual5dPct != null ? `${r.actual5dPct > 0 ? '+' : ''}${r.actual5dPct}%` : '待回填';
      lines.push(`${indent}    ${mark} ${r.date} LLM=${r.llmScore} 预测=${r.pred} 5日=${ret}`);
    }
  }
  return lines.join('\n');
}

export function formatPredictionTrackMarkdown(stats: PredictionTrackStats): string {
  const lines = [
    '## 📊 历史预测对错',
    '',
    `> 窗口近 **${stats.windowDays}** 日 · 标签：**5 个交易日** SPX 涨跌 · 样本 **${stats.sampleEligible}** 条 · 统计日 ${stats.asOf}`,
    '',
    stats.summary,
    '',
    '### 关键统计',
    '',
    '| 指标 | 数值 |',
    '|------|------|',
    `| LLM 方向命中 | ${stats.llm.hitRate != null ? `**${stats.llm.hitRate}%**（${stats.llm.hits}/${stats.llm.total}）` : 'N/A'} |`,
    `| 量化方向命中 | ${stats.quant.hitRate != null ? `**${stats.quant.hitRate}%**（${stats.quant.hits}/${stats.quant.total}）` : 'N/A（待积累 quant_score）'} |`,
    `| 高分段(≥60) 5日涨概率 | ${stats.highScoreUpRate != null ? `**${stats.highScoreUpRate}%**（n=${stats.highScoreN}）` : 'N/A'} |`,
    `| 低分段(≤40) 5日涨概率 | ${stats.lowScoreUpRate != null ? `**${stats.lowScoreUpRate}%**（n=${stats.lowScoreN}）` : 'N/A'} |`,
    `| 双分冲突日 | **${stats.conflictDays}**（跟量化对 ${stats.conflictFollowQuantHits} / 跟LLM对 ${stats.conflictFollowLlmHits}） |`,
    '',
  ];

  if (stats.buckets.length) {
    lines.push('### 评分区间 vs 实际 5 日');
    lines.push('');
    lines.push('| 评分区间 | 样本 | 实际涨概率 | 平均涨幅 |');
    lines.push('|----------|------|------------|----------|');
    for (const b of stats.buckets) {
      lines.push(`| ${b.range} | ${b.sample} | ${b.upRate}% | ${b.avgReturn > 0 ? '+' : ''}${b.avgReturn}% |`);
    }
    lines.push('');
  }

  if (stats.recent.length) {
    lines.push('### 最近预测明细');
    lines.push('');
    lines.push('| 日期 | LLM | 量化 | 预测 | 5日涨跌 | 对错 |');
    lines.push('|------|-----|------|------|---------|------|');
    for (const r of stats.recent.slice(0, 12)) {
      const mark = r.status === 'hit' ? '✅' : r.status === 'miss' ? '❌' : r.status === 'flat' ? '➖' : '⏳';
      const ret = r.actual5dPct != null ? `${r.actual5dPct > 0 ? '+' : ''}${r.actual5dPct}%` : '—';
      const q = r.quantScore != null ? String(r.quantScore) : '—';
      lines.push(`| ${r.date} | ${r.llmScore} | ${q} | ${r.pred} | ${ret} | ${mark} |`);
    }
    lines.push('');
  }

  lines.push('> 预测方向：分数 &gt;55 记「涨」，&lt;45 记「跌」，中间不计入命中率；持平(|涨跌|≤0.1%) 不计对错。非投资业绩承诺。');
  lines.push('');
  return lines.join('\n');
}
