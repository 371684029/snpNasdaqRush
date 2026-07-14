// 价格内部一致性校验 — 三合一程序化检查，不依赖 LLM
// 对齐 goldRush price-consistency.ts，适配美股指数

import { getDb } from '../db/index.js';
import { IndexPricesRepo } from '../db/index-prices.js';

export interface ConsistencyReport {
  bonusConfidence: number;
  warnings: string[];
  details: {
    spxYahoo: { passed: boolean; deviationPct: number | null; yahooPrice: number | null };
    spyTracking: { passed: boolean; deviationPct: number | null };
    historical: { passed: boolean; dayChangePct: number | null };
  };
}

/** SPX vs Yahoo ^GSPC 锚定检查 */
function checkSpxYahoo(spxPrice: number, yahooSpxPrice: number | null): { passed: boolean; deviationPct: number | null; yahooPrice: number | null; bonus: number; warnings: string[] } {
  const warnings: string[] = [];
  let bonus = 0;
  if (!yahooSpxPrice) return { passed: false, deviationPct: null, yahooPrice: null, bonus, warnings };
  const devPct = Math.abs((spxPrice - yahooSpxPrice) / yahooSpxPrice) * 100;
  if (devPct < 1) { bonus = 15; return { passed: true, deviationPct: devPct, yahooPrice: yahooSpxPrice, bonus, warnings }; }
  if (devPct < 3) { bonus = 5; return { passed: true, deviationPct: devPct, yahooPrice: yahooSpxPrice, bonus, warnings }; }
  warnings.push(`🔴 LLM 提取 SPX ${spxPrice} 与 Yahoo ^GSPC ${yahooSpxPrice} 偏差 ${devPct.toFixed(1)}%`);
  bonus = -15;
  return { passed: false, deviationPct: devPct, yahooPrice: yahooSpxPrice, bonus, warnings };
}

/** SPX ↔ SPY 跟踪误差（理论：SPY ≈ SPX / 10） */
function checkSpyTracking(spxPrice: number, spyNav: number | null): { passed: boolean; deviationPct: number | null; bonus: number; warnings: string[] } {
  const warnings: string[] = [];
  let bonus = 0;
  if (!spyNav) return { passed: false, deviationPct: null, bonus, warnings };
  const impliedSpy = spxPrice / 10;
  const devPct = Math.abs((spyNav - impliedSpy) / impliedSpy) * 100;
  if (devPct < 1) { bonus = 10; return { passed: true, deviationPct: devPct, bonus, warnings }; }
  if (devPct < 3) { bonus = 3; return { passed: true, deviationPct: devPct, bonus, warnings }; }
  if (devPct > 5) { warnings.push(`🟡 SPX↔SPY 跟踪偏差 ${devPct.toFixed(1)}%（SPX÷10=${impliedSpy.toFixed(2)}, SPY=${spyNav.toFixed(2)}）`); }
  if (devPct > 10) { bonus = -10; warnings.push(`🔴 SPX↔SPY 跟踪偏差 ${devPct.toFixed(1)}%，可能存在数据错误`); }
  return { passed: devPct < 5, deviationPct: devPct, bonus, warnings };
}

/** 历史连续检查：日波动 >5% 告警，3 日冻结告警 */
function checkHistorical(spxPrice: number): { passed: boolean; dayChangePct: number | null; bonus: number; warnings: string[] } {
  const warnings: string[] = [];
  let bonus = 0;
  try {
    const db = getDb();
    const repo = new IndexPricesRepo(db);
    const recent = repo.getRecent(5);
    if (recent.length < 2) return { passed: true, dayChangePct: null, bonus, warnings };
    const prev = [...recent].reverse().find(r => r.spxClose != null);
    if (!prev?.spxClose) return { passed: true, dayChangePct: null, bonus, warnings };
    const dayChg = ((spxPrice - prev.spxClose) / prev.spxClose) * 100;
    if (Math.abs(dayChg) < 2) bonus = 5;
    else if (Math.abs(dayChg) < 5) bonus = 2;
    else {
      warnings.push(`🔴 SPX 日波动 ${dayChg >= 0 ? '+' : ''}${dayChg.toFixed(2)}%（前一日 ${prev.spxClose}），可能数据异常`);
      bonus = -10;
    }
    // 3 日冻结检测
    const last3 = recent.slice(-3).filter(r => r.spxClose != null);
    if (last3.length === 3 && last3.every(r => r.spxClose === last3[0].spxClose)) {
      warnings.push('🔴 SPX 连续 3 天未变动，可能数据源未更新');
      bonus -= 15;
    }
    return { passed: Math.abs(dayChg) < 5, dayChangePct: dayChg, bonus, warnings };
  } catch { return { passed: true, dayChangePct: null, bonus, warnings }; }
}

export function checkIndexPriceConsistency(
  spxPrice: number,
  spyNav: number | null,
  yahooSpxPrice: number | null,
): ConsistencyReport {
  const warnings: string[] = [];
  let bonus = 0;

  const spxYahoo = checkSpxYahoo(spxPrice, yahooSpxPrice);
  bonus += spxYahoo.bonus;
  warnings.push(...spxYahoo.warnings);

  const spyTrack = checkSpyTracking(spxPrice, spyNav);
  bonus += spyTrack.bonus;
  warnings.push(...spyTrack.warnings);

  const hist = checkHistorical(spxPrice);
  bonus += hist.bonus;
  warnings.push(...hist.warnings);

  return {
    bonusConfidence: Math.max(-20, Math.min(30, bonus)),
    warnings,
    details: {
      spxYahoo: { passed: spxYahoo.passed, deviationPct: spxYahoo.deviationPct, yahooPrice: spxYahoo.yahooPrice },
      spyTracking: { passed: spyTrack.passed, deviationPct: spyTrack.deviationPct },
      historical: { passed: hist.passed, dayChangePct: hist.dayChangePct },
    },
  };
}
