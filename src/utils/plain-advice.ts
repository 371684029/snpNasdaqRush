// 自然语言建议 — 评分 → 人话 + 一致性 + 统一操作出口
// 保留 main 的 scoreToAdvice；补齐 dual-score / reliability / report-md 所需 API

import type { Direction } from '../types/analysis.js';

export interface PlainAdvice {
  emoji: string;
  label: string;
  headline: string;
  action: string;
  color: string;
  level: number; // 0=强空, 1=弱空, 2=中性, 3=弱多, 4=强多
}

export function scoreToAdvice(score: number, direction?: string): PlainAdvice {
  const d = direction || (score >= 58 ? 'bullish' : score <= 42 ? 'bearish' : 'neutral');
  if (score >= 80) return { emoji: '🚀', label: '强烈偏多', headline: '多项指标共振看多', action: '可适度加仓；回调至均线支撑位是加码机会', color: '#22c55e', level: 4 };
  if (score >= 65 && d === 'bullish') return { emoji: '📈', label: '偏多', headline: '短期动能偏强', action: '维持仓位；回调至支撑位可小幅加仓，高位不追', color: '#22c55e', level: 3 };
  if (score >= 50) return { emoji: '➡️', label: '中性偏多', headline: '震荡偏强，方向待确认', action: '维持现有仓位，按纪律执行；等待更明确信号', color: '#f59e0b', level: 2 };
  if (score >= 35) return { emoji: '⚠️', label: '中性偏空', headline: '风险升温，谨慎为上', action: '仓位控制在 50% 以下；暂停加仓，设置紧密止损', color: '#f59e0b', level: 1 };
  return { emoji: '🔴', label: '偏空', headline: '下行风险大于反弹空间', action: '减仓至 30% 以下；清仓高 beta 品种；等评分回升再入场', color: '#ef4444', level: 0 };
}

export type AdviceSource = 'data_gate' | 'dual_conflict' | 'position' | 'score';

export interface OperationalAdvice {
  emoji: string;
  label: string;
  headline: string;
  action: string;
  source: AdviceSource;
  color: string;
  bg: string;
}

const COLORS: Record<string, { color: string; bg: string }> = {
  red: { color: '#ef4444', bg: '#ef444418' },
  orange: { color: '#f97316', bg: '#f9731618' },
  yellow: { color: '#f59e0b', bg: '#f59e0b18' },
  green: { color: '#22c55e', bg: '#22c55e18' },
  blue: { color: '#3b82f6', bg: '#3b82f618' },
  gray: { color: '#94a3b8', bg: '#33415544' },
};

export interface ResolveOperationalAdviceInput {
  llmScore?: number | null;
  direction?: Direction | null;
  dataActionable?: boolean | null;
  dualActionOverride?: { headline: string; action: string } | null;
  dualPolicy?: string | null;
  position?: {
    headline: string;
    action: string;
    emoji: string;
    label: string;
    tilt?: 'reduce' | 'hold' | 'add';
    targetPct?: number;
  } | null;
}

/**
 * 统一操作建议出口
 * 优先级：门禁红档 → 双分冲突 → 仓位推荐 → LLM 分映射
 */
export function resolveOperationalAdvice(input: ResolveOperationalAdviceInput): OperationalAdvice | null {
  if (input.dataActionable === false) {
    const c = COLORS.red;
    return {
      label: '数据不可用',
      emoji: '🔴',
      headline: '数据质量不足，暂停依据本报告操作',
      action: '维持既有定投纪律或观望；修复数据后重新 analysis',
      source: 'data_gate',
      color: c.color,
      bg: c.bg,
    };
  }

  const dualHold =
    input.dualPolicy === 'hold_on_conflict'
    || (input.dualActionOverride != null && input.dualActionOverride.headline.length > 0);
  if (dualHold) {
    const ov = input.dualActionOverride;
    const c = COLORS.gray;
    return {
      label: '双分冲突·弃权',
      emoji: '⚖️',
      headline: ov?.headline ?? '双体系不一致，操作弃权',
      action: ov?.action ?? '维持基础定投（SPY/VOO），按日历执行；待双分同向或校准明确后再加减仓',
      source: 'dual_conflict',
      color: c.color,
      bg: c.bg,
    };
  }

  if (input.position?.action) {
    const p = input.position;
    const pct = p.targetPct != null ? `（约 ${p.targetPct}%）` : '';
    const palette = p.tilt === 'reduce' ? 'orange' : p.tilt === 'add' ? 'green' : 'yellow';
    const c = COLORS[palette];
    return {
      label: p.label || '仓位建议',
      emoji: p.emoji || '📦',
      headline: p.headline,
      action: p.action.includes('计划仓') ? p.action : `${p.action}${pct}`,
      source: 'position',
      color: c.color,
      bg: c.bg,
    };
  }

  if (input.llmScore == null || !Number.isFinite(input.llmScore)) return null;
  const base = scoreToAdvice(input.llmScore, input.direction ?? undefined);
  const palette =
    input.llmScore <= 30 ? 'red'
      : input.llmScore <= 45 ? 'orange'
        : input.llmScore <= 55 ? 'yellow'
          : input.llmScore <= 75 ? 'green'
            : 'blue';
  const c = COLORS[palette];
  return {
    ...base,
    source: 'score',
    color: c.color,
    bg: c.bg,
  };
}

export interface ConsistencyCheck {
  consensus: 'bullish' | 'bearish' | 'mixed';
  agreedCount: number;
  dissenters: string[];
  strength: 'strong' | 'moderate' | 'weak';
  /** dual-score / reliability 兼容字段 */
  level: 'strong' | 'moderate' | 'weak';
  agreeCount: number;
  totalCount: number;
  consensusDirection: Direction | null;
  summary: string;
}

/** 三维一致性（main 既有签名） */
export function checkConsistency(
  technical: { score: number; direction: string },
  fundamental: { score: number; direction: string },
  sentiment: { score: number; direction: string },
): ConsistencyCheck {
  const dims = [
    { name: '技术面', score: technical.score, direction: technical.direction },
    { name: '基本面', score: fundamental.score, direction: fundamental.direction },
    { name: '情绪面', score: sentiment.score, direction: sentiment.direction },
  ];
  const bullish = dims.filter(d => d.direction === 'bullish');
  const bearish = dims.filter(d => d.direction === 'bearish');

  let consensus: 'bullish' | 'bearish' | 'mixed';
  let agreedCount: number;
  let strength: 'strong' | 'moderate' | 'weak';

  if (bullish.length >= 2) {
    consensus = 'bullish';
    agreedCount = bullish.length;
    strength = bullish.length === 3 ? 'strong' : 'moderate';
  } else if (bearish.length >= 2) {
    consensus = 'bearish';
    agreedCount = bearish.length;
    strength = bearish.length === 3 ? 'strong' : 'moderate';
  } else {
    consensus = 'mixed';
    agreedCount = 0;
    strength = 'weak';
  }

  const dissenters = dims
    .filter(d => d.direction !== (consensus === 'bullish' ? 'bullish' : consensus === 'bearish' ? 'bearish' : ''))
    .map(d => d.name);

  const consensusDirection: Direction | null =
    consensus === 'bullish' ? 'bullish' : consensus === 'bearish' ? 'bearish' : null;
  const summary = consensusDirection
    ? `${agreedCount}/3 维度一致${consensusDirection === 'bullish' ? '偏多' : '偏空'}${dissenters.length ? `，${dissenters.join('、')}唱反调` : ''}`
    : '3 维度方向分歧，各执一词';

  return {
    consensus,
    agreedCount,
    dissenters,
    strength,
    level: strength,
    agreeCount: agreedCount || (3 - dissenters.length),
    totalCount: 3,
    consensusDirection,
    summary,
  };
}

export function consistencyEmoji(level: ConsistencyCheck['level']): string {
  if (level === 'strong') return '✅';
  if (level === 'moderate') return '⚠️';
  return '🔴';
}
