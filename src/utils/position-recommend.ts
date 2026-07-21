// 当前仓位推荐 — 相对「计划美股仓位」的 0–100% 建议（SPY/VOO 定投）
//
// v2 核心：门禁/双分上限 + 波动/回撤缩放 + 日平滑

import type { Direction } from '../types/analysis.js';

export type PositionLabel = '极轻' | '偏轻' | '标配' | '偏积极' | '积极';

/** 风险角标（给人看的） */
export type PositionRiskBadge = '平稳' | '偏高波动' | '高波动' | '近窗回撤' | '日调受限';

export interface PositionRecommendation {
  /** 相对计划美股总仓 0–100 */
  targetPct: number;
  /** 平滑/约束前的原始目标（便于解释） */
  rawTargetPct: number;
  /** 其中定投/底仓占比（占 target 的百分比） */
  coreSharePct: number;
  /** 波段/卫星仓占比（占 target） */
  satelliteSharePct: number;
  label: PositionLabel;
  emoji: string;
  headline: string;
  action: string;
  reasons: string[];
  /** 约束标记：门禁红、双分冲突、波动等 */
  constraints: string[];
  /** 建议操作：减/持/加 */
  tilt: 'reduce' | 'hold' | 'add';
  risk: {
    vol20AnnPct: number | null;
    drawdown60Pct: number | null;
    prevTargetPct: number | null;
    deltaFromPrev: number | null;
    volScalar: number;
    ddScalar: number;
    badges: PositionRiskBadge[];
    summary: string;
  };
}

export interface PositionRecommendInput {
  llmScore: number;
  quantScore?: number | null;
  dataActionable?: boolean;
  dualPolicy?: string | null;
  consistencyLevel?: 'strong' | 'moderate' | 'weak' | null;
  direction?: Direction | null;
  /** SPX 收盘序列（旧→新），用于波动与回撤 */
  closes?: number[] | null;
  previousTargetPct?: number | null;
  maxDailyDelta?: number;
}

export const POSITION_MAX_DAILY_DELTA = 10;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function scoreToBasePct(score: number): number {
  if (score <= 25) return 25;
  if (score <= 35) return 35;
  if (score <= 45) return 45;
  if (score <= 55) return 55;
  if (score <= 65) return 65;
  if (score <= 75) return 75;
  return 85;
}

function labelFromPct(pct: number): PositionLabel {
  if (pct <= 30) return '极轻';
  if (pct <= 45) return '偏轻';
  if (pct <= 60) return '标配';
  if (pct <= 75) return '偏积极';
  return '积极';
}

function emojiFromLabel(l: PositionLabel): string {
  if (l === '极轻') return '🔴';
  if (l === '偏轻') return '🟠';
  if (l === '标配') return '🟡';
  if (l === '偏积极') return '🟢';
  return '🔵';
}

export function computePriceRiskMetrics(closes: number[]): {
  vol20AnnPct: number | null;
  drawdown60Pct: number | null;
} {
  const c = closes.filter(x => Number.isFinite(x) && x > 0);
  if (c.length < 5) {
    return { vol20AnnPct: null, drawdown60Pct: null };
  }

  const rets: number[] = [];
  for (let i = 1; i < c.length; i++) {
    rets.push((c[i] - c[i - 1]) / c[i - 1]);
  }
  const last20 = rets.slice(-20);
  let vol20AnnPct: number | null = null;
  if (last20.length >= 10) {
    const mean = last20.reduce((a, b) => a + b, 0) / last20.length;
    const varSum = last20.reduce((a, b) => a + (b - mean) ** 2, 0) / last20.length;
    const dailyStd = Math.sqrt(varSum);
    vol20AnnPct = Math.round(dailyStd * Math.sqrt(252) * 1000) / 10;
  }

  const win = c.slice(-60);
  let peak = win[0];
  let maxDd = 0;
  for (const px of win) {
    if (px > peak) peak = px;
    const dd = peak > 0 ? (peak - px) / peak : 0;
    if (dd > maxDd) maxDd = dd;
  }
  const drawdown60Pct = Math.round(maxDd * 1000) / 10;

  return { vol20AnnPct, drawdown60Pct };
}

/**
 * 权益波动阈值：
 *   <12% → 1.0
 *   12–16% → 0.92
 *   16–22% → 0.85
 *   >22% → 0.75
 */
export function volToScalar(vol20AnnPct: number | null): number {
  if (vol20AnnPct == null || !Number.isFinite(vol20AnnPct)) return 1;
  if (vol20AnnPct < 12) return 1;
  if (vol20AnnPct < 16) return 0.92;
  if (vol20AnnPct < 22) return 0.85;
  return 0.75;
}

/**
 * 回撤缩放（与黄金同阈值）：
 *   <5% → 1
 *   5–10% → 0.95
 *   10–15% → 0.88
 *   >15% → 0.8
 */
export function drawdownToScalar(ddPct: number | null): number {
  if (ddPct == null || !Number.isFinite(ddPct)) return 1;
  if (ddPct < 5) return 1;
  if (ddPct < 10) return 0.95;
  if (ddPct < 15) return 0.88;
  return 0.8;
}

export function smoothTargetPct(
  raw: number,
  previous: number | null | undefined,
  maxDelta = POSITION_MAX_DAILY_DELTA,
): { target: number; applied: boolean; delta: number | null } {
  if (previous == null || !Number.isFinite(previous)) {
    return { target: raw, applied: false, delta: null };
  }
  const lo = previous - maxDelta;
  const hi = previous + maxDelta;
  const target = clamp(raw, lo, hi);
  return {
    target: Math.round(target),
    applied: target !== raw,
    delta: Math.round(target - previous),
  };
}

export function recommendPosition(input: PositionRecommendInput): PositionRecommendation {
  const reasons: string[] = [];
  const constraints: string[] = [];
  const badges: PositionRiskBadge[] = [];

  let score = input.llmScore;
  if (input.quantScore != null && Number.isFinite(input.quantScore)) {
    score = Math.round((input.llmScore + input.quantScore) / 2);
    reasons.push(`综合参考分 ${score}（LLM ${input.llmScore} / 量化 ${input.quantScore} 均值）`);
  } else {
    reasons.push(`参考 LLM 分 ${input.llmScore}`);
  }

  let target = scoreToBasePct(score);

  // 门禁红档：≤35
  if (input.dataActionable === false) {
    target = Math.min(target, 35);
    constraints.push('数据门禁红档：上限 35%');
  }

  // 双分冲突：≤50
  if (input.dualPolicy === 'hold_on_conflict') {
    target = Math.min(target, 50);
    constraints.push('双分冲突：操作弃权，仓位不超过标配 50%');
  }

  if (input.consistencyLevel === 'weak') {
    target = Math.min(target, 50);
    constraints.push('四维一致性弱：不加仓');
  }

  target = clamp(target, 15, 90);

  const metrics = computePriceRiskMetrics(input.closes ?? []);
  const volScalar = volToScalar(metrics.vol20AnnPct);
  const ddScalar = drawdownToScalar(metrics.drawdown60Pct);
  const riskScalar = volScalar * ddScalar;

  if (metrics.vol20AnnPct != null) {
    if (volScalar < 0.8) {
      badges.push('高波动');
      constraints.push(`高波动（近20日年化约 ${metrics.vol20AnnPct}%）：仓位×${volScalar}`);
    } else if (volScalar < 1) {
      badges.push('偏高波动');
      constraints.push(`偏高波动（近20日年化约 ${metrics.vol20AnnPct}%）：仓位×${volScalar}`);
    } else {
      badges.push('平稳');
      reasons.push(`波动正常（近20日年化约 ${metrics.vol20AnnPct}%）`);
    }
  }
  if (metrics.drawdown60Pct != null && ddScalar < 1) {
    badges.push('近窗回撤');
    constraints.push(`近60日自高点回撤约 ${metrics.drawdown60Pct}%：仓位×${ddScalar}`);
  }

  if (riskScalar < 0.999) {
    const before = target;
    target = target * riskScalar;
    reasons.push(`风险缩放 ${before.toFixed(0)}% → ${target.toFixed(0)}%（波动×回撤）`);
  }

  target = Math.round(clamp(target, 15, 90));
  const rawTargetPct = target;

  const maxDelta = input.maxDailyDelta ?? POSITION_MAX_DAILY_DELTA;
  const sm = smoothTargetPct(target, input.previousTargetPct, maxDelta);
  target = sm.target;
  if (sm.applied) {
    badges.push('日调受限');
    constraints.push(
      `日平滑：相对昨日 ${input.previousTargetPct}% 单日最多±${maxDelta}点 → 今日 ${target}%（原 ${rawTargetPct}%）`,
    );
  }

  let coreShare = 70;
  if (target <= 40) coreShare = 85;
  else if (target <= 55) coreShare = 75;
  else if (target >= 75) coreShare = 60;
  if (input.dualPolicy === 'hold_on_conflict' || input.dataActionable === false) {
    coreShare = Math.max(coreShare, 85);
  }
  if (volScalar <= 0.85 || ddScalar <= 0.88) {
    coreShare = Math.max(coreShare, 80);
  }
  const satelliteShare = 100 - coreShare;

  const label = labelFromPct(target);
  const emoji = emojiFromLabel(label);

  let tilt: PositionRecommendation['tilt'] = 'hold';
  if (target <= 40) tilt = 'reduce';
  else if (target >= 70) tilt = 'add';

  let headline: string;
  let action: string;
  if (input.dataActionable === false) {
    headline = '数据不可靠，建议维持轻仓纪律仓';
    action = `建议相对计划美股仓约 ${target}%（定投层 ${coreShare}% / 波段层 ${satelliteShare}%）；暂停加仓，修好数据再评估`;
  } else if (input.dualPolicy === 'hold_on_conflict') {
    headline = '双体系不一致，维持纪律仓、不追方向';
    action = `建议相对计划美股仓约 ${target}%；以 SPY/VOO 定投层为主（${coreShare}%），波段仓轻仓或空仓`;
  } else if (badges.includes('高波动') || badges.includes('近窗回撤')) {
    headline = '风险偏高，仓位已自动收一收';
    action = `建议相对计划美股仓约 ${target}%（${label}）；定投层为主（${coreShare}%），少做波段加仓`;
  } else if (tilt === 'reduce') {
    headline = '建议偏轻：控制美股风险暴露';
    action = `建议相对计划美股仓约 ${target}%（${label}）；可降 SPY/VOO 单次定投额，波段仓观望`;
  } else if (tilt === 'add') {
    headline = '可偏积极，但仍忌一次性重仓';
    action = `建议相对计划美股仓约 ${target}%（${label}）；SPY/VOO 定投维持，急跌再小加卫星仓`;
  } else {
    headline = '标配附近：纪律定投为主';
    action = `建议相对计划美股仓约 ${target}%（${label}）；按日历定投 SPY/VOO，少做择时加减`;
  }

  const riskBits: string[] = [];
  if (metrics.vol20AnnPct != null) riskBits.push(`波动约${metrics.vol20AnnPct}%`);
  if (metrics.drawdown60Pct != null && metrics.drawdown60Pct >= 3) {
    riskBits.push(`近高点回撤${metrics.drawdown60Pct}%`);
  }
  if (sm.delta != null) riskBits.push(`较昨日${sm.delta > 0 ? '+' : ''}${sm.delta}点`);
  const riskSummary = riskBits.length
    ? riskBits.join(' · ')
    : '风险指标样本不足，未做波动缩放';

  return {
    targetPct: target,
    rawTargetPct,
    coreSharePct: coreShare,
    satelliteSharePct: satelliteShare,
    label,
    emoji,
    headline,
    action,
    reasons,
    constraints,
    tilt,
    risk: {
      vol20AnnPct: metrics.vol20AnnPct,
      drawdown60Pct: metrics.drawdown60Pct,
      prevTargetPct: input.previousTargetPct ?? null,
      deltaFromPrev: sm.delta,
      volScalar,
      ddScalar,
      badges: badges.length ? badges : ['平稳'],
      summary: riskSummary,
    },
  };
}

export function extractPreviousTargetPct(previous: unknown): number | null {
  if (!previous || typeof previous !== 'object') return null;
  const r = previous as Record<string, unknown>;
  if (typeof r.positionTargetPct === 'number' && Number.isFinite(r.positionTargetPct)) {
    return Math.round(r.positionTargetPct);
  }
  const overall = r.overall as Record<string, unknown> | undefined;
  if (overall && typeof overall.positionTargetPct === 'number') {
    return Math.round(overall.positionTargetPct as number);
  }
  return null;
}

export function parseTargetPctFromPositionMarkdown(md: string): number | null {
  const m = md.match(/相对计划美股仓\s*\*{0,2}(\d+)\s*%/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

export function formatPositionConsole(p: PositionRecommendation, indent = '  '): string {
  const riskBadges = p.risk.badges.join('·');
  const lines = [
    `${indent}📦 当前仓位推荐（相对计划美股仓 · SPY/VOO 定投 · 风险约束 v2）`,
    `${indent}  ${p.emoji} ${p.label} · 目标 ${p.targetPct}%` +
      (p.rawTargetPct !== p.targetPct ? `（平滑前 ${p.rawTargetPct}%）` : '') +
      ` · 定投层 ${p.coreSharePct}% / 波段层 ${p.satelliteSharePct}%`,
    `${indent}  🛡️ 风险：${riskBadges} · ${p.risk.summary}`,
    `${indent}  ${p.headline}`,
    `${indent}  → ${p.action}`,
  ];
  if (p.constraints.length) {
    lines.push(`${indent}  约束：${p.constraints.join('；')}`);
  }
  if (p.reasons.length) {
    lines.push(`${indent}  依据：${p.reasons.slice(0, 4).join('；')}`);
  }
  lines.push(`${indent}  （非绝对账户比例，亦非杠杆建议）`);
  return lines.join('\n');
}

export function formatPositionMarkdown(p: PositionRecommendation): string {
  const riskBadges = p.risk.badges.map(b => `\`${b}\``).join(' ');
  const lines = [
    '## 📦 当前仓位推荐',
    '',
    `> ${p.emoji} **${p.label}** · 相对计划美股仓 **${p.targetPct}%**` +
      (p.rawTargetPct !== p.targetPct ? `（风险/平滑前 ${p.rawTargetPct}%）` : '') +
      ` · 定投层 ${p.coreSharePct}% / 波段层 ${p.satelliteSharePct}%`,
    '',
    `- **结论**：${p.headline}`,
    `- **操作**：${p.action}`,
    `- **倾向**：${p.tilt === 'reduce' ? '减仓/偏轻' : p.tilt === 'add' ? '可小幅积极' : '维持'}`,
    `- **风险角标**：${riskBadges}`,
    `- **风险摘要**：${p.risk.summary}`,
  ];
  if (p.risk.vol20AnnPct != null) {
    lines.push(`- **近20日波动（年化近似）**：${p.risk.vol20AnnPct}%（缩放×${p.risk.volScalar}）`);
  }
  if (p.risk.drawdown60Pct != null) {
    lines.push(`- **近60日自高点回撤**：${p.risk.drawdown60Pct}%（缩放×${p.risk.ddScalar}）`);
  }
  if (p.risk.prevTargetPct != null) {
    const d = p.risk.deltaFromPrev;
    lines.push(
      `- **较昨日目标仓**：${p.risk.prevTargetPct}% → ${p.targetPct}%` +
        (d != null ? `（${d > 0 ? '+' : ''}${d} 点，单日限幅±${POSITION_MAX_DAILY_DELTA}）` : ''),
    );
  }
  if (p.constraints.length) {
    lines.push(`- **约束**：${p.constraints.join('；')}`);
  }
  if (p.reasons.length) {
    lines.push(`- **依据**：${p.reasons.join('；')}`);
  }
  lines.push('');
  lines.push(
    '> 仓位百分比均相对于你预设的「美股计划仓」=100%，不是总资产杠杆。' +
      '建议以 SPY/VOO 定投为主；波动大/刚从高点回撤时会自动少拿一点。不构成投资建议。',
  );
  lines.push('');
  return lines.join('\n');
}
