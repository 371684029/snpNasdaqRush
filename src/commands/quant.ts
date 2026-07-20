// snprush quant — 纯本地量化评分（零 LLM）+ 与最新 LLM 研判的双打分对照

import { getDb } from '../db/index.js';
import { IndexPricesRepo } from '../db/index-prices.js';
import { ReportsRepo } from '../db/reports.js';
import { computeQuantScore, formatQuantScoreConsole } from '../indicators/quant-score.js';
import { evaluateDualScore, formatDualScoreConsole } from '../utils/dual-score.js';
import { scoreToAdvice } from '../utils/plain-advice.js';
import { header, separator } from '../utils/format.js';

export async function quantCommand(days: number = 120): Promise<void> {
  const db = getDb();
  const prices = new IndexPricesRepo(db);
  const rows = prices.getRecent(days); // 升序

  const num = (arr: (number | null)[]): number[] => arr.filter((v): v is number => v != null);
  const closes = num(rows.map(r => r.spxClose));
  const vix = num(rows.map(r => r.vix));
  const dxy = num(rows.map(r => r.dollarIndex));
  const us10y = num(rows.map(r => r.us10yYield));
  const us2y = num(rows.map(r => r.us2yYield));

  console.log(header('🔢 SnpRush 量化评分', `样本 ${closes.length} 日 | 纯本地计算 · 零 LLM`));

  if (closes.length < 20) {
    console.log(`\n  ⚠️ 指数历史不足 20 天（当前 ${closes.length} 天），量化评分需要更多数据。`);
    console.log('  请多次运行 snprush price / analysis 积累数据后再试。');
    console.log(separator('═', 55));
    return;
  }

  const quant = computeQuantScore({ closes, vix, dxy, us10y, us2y });
  console.log('');
  console.log(formatQuantScoreConsole(quant));

  // 与最新 LLM 研判做双打分对照
  const reports = new ReportsRepo(db);
  const latest = reports.getRecent(3650)[0];
  console.log('');
  if (latest) {
    const verdict = evaluateDualScore(latest.overallScore, quant.score);
    console.log(`  📅 最新 LLM 研判：${latest.date} · ${latest.overallScore}/100 · ${latest.direction}`);
    console.log(formatDualScoreConsole(verdict));
  } else {
    console.log('  ℹ️ 暂无 LLM 分析报告，仅显示量化分。运行 snprush analysis 后可对照双打分。');
  }

  // 人话建议（基于量化分）
  const advice = scoreToAdvice(quant.score);
  console.log('');
  console.log(`  ${advice.emoji} 人话建议（量化分 ${quant.score}）：${advice.headline}`);
  console.log(`     → ${advice.action}`);

  console.log(separator('═', 55));
}
