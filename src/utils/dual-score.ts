// 双打分机制：LLM 分 vs 量化分 — 并存、分别校准、冲突有规则
// 适配美股 ETF 定投场景（SPY/QQQ/VOO）

import type { Direction } from '../types/analysis.js';

/** 冲突阈值：绝对分差 */
export const DUAL_CONFLICT_THRESHOLD = 15;
/** 温和偏差上限 */
export const DUAL_MILD_GAP = 8;

export type DualAlignment = 'aligned' | 'mild_gap' | 'conflict' | 'quant_missing';

export type DualActionPolicy =
  | 'both'
  | 'quant_preferred'
  | 'hold_on_conflict'
  | 'llm_only';

export interface DualScoreVerdict {
  llmScore: number;
  quantScore: number | null;
  delta: number | null;
  alignment: DualAlignment;
  llmDirection: Direction;
  quantDirection: Direction | null;
  sameDirection: boolean | null;
  actionPolicy: DualActionPolicy;
  banners: string[];
  actionOverride: { headline: string; action: string } | null;
}

export function dualDirectionFromScore(score: number): Direction {
  if (score >= 58) return 'bullish';
  if (score <= 42) return 'bearish';
  return 'neutral';
}

export function dirLabel(d: Direction): string {
  if (d === 'bullish') return '偏多';
  if (d === 'bearish') return '偏空';
  return '中性';
}

/**
 * 评估双打分关系与操作策略。
 */
export function evaluateDualScore(
  llmScore: number,
  quantScore: number | null | undefined,
  opts?: {
    consistencyWeak?: boolean;
    dataActionable?: boolean;
  },
): DualScoreVerdict {
  const banners: string[] = [];
  const llmDirection = dualDirectionFromScore(llmScore);

  if (quantScore == null || !Number.isFinite(quantScore)) {
    banners.push('🔢 双打分：仅有 LLM 分（量化分缺失，请检查指数历史是否充足）');
    return {
      llmScore,
      quantScore: null,
      delta: null,
      alignment: 'quant_missing',
      llmDirection,
      quantDirection: null,
      sameDirection: null,
      actionPolicy: 'llm_only',
      banners,
      actionOverride: null,
    };
  }

  const q = Math.round(quantScore);
  const delta = Math.round(llmScore - q);
  const abs = Math.abs(delta);
  const quantDirection = dualDirectionFromScore(q);
  const sameDirection = llmDirection === quantDirection;

  let alignment: DualAlignment;
  if (abs <= DUAL_MILD_GAP) alignment = 'aligned';
  else if (abs <= DUAL_CONFLICT_THRESHOLD) alignment = 'mild_gap';
  else alignment = 'conflict';

  if (opts?.dataActionable === false) {
    banners.push(`🔢 双打分：LLM=${llmScore} · 量化=${q} · 偏差=${delta > 0 ? '+' : ''}${delta}`);
    banners.push('   · 数据门禁红档：操作结论已关闭（与双分无关）');
    return {
      llmScore,
      quantScore: q,
      delta,
      alignment,
      llmDirection,
      quantDirection,
      sameDirection,
      actionPolicy: 'hold_on_conflict',
      banners,
      actionOverride: {
        headline: '数据质量不足，暂停依据本报告操作',
        action: '维持既有定投纪律或观望；修复数据后重新 analysis',
      },
    };
  }

  if (opts?.consistencyWeak || alignment === 'conflict' || (alignment === 'mild_gap' && !sameDirection)) {
    const reasons: string[] = [];
    if (opts?.consistencyWeak) reasons.push('四维度一致性弱');
    if (alignment === 'conflict') {
      reasons.push(`|LLM−量化|=${abs}>${DUAL_CONFLICT_THRESHOLD}`);
    }
    if (alignment === 'mild_gap' && !sameDirection) {
      reasons.push(`方向不一致（LLM${dirLabel(llmDirection)} vs 量化${dirLabel(quantDirection)}）`);
    }

    banners.push(`🔢 双打分冲突/不确定：LLM=${llmScore}（${dirLabel(llmDirection)}）· 量化=${q}（${dirLabel(quantDirection)}）· 偏差=${delta > 0 ? '+' : ''}${delta}`);
    banners.push(`   · 原因：${reasons.join('；')}`);
    banners.push('   · 策略：两套分数均展示；操作弃权 → 维持定投，不据此加减仓');

    return {
      llmScore,
      quantScore: q,
      delta,
      alignment: alignment === 'aligned' ? 'mild_gap' : alignment,
      llmDirection,
      quantDirection,
      sameDirection,
      actionPolicy: 'hold_on_conflict',
      banners,
      actionOverride: {
        headline: '双体系不一致，操作弃权',
        action: '维持基础定投（SPY/VOO），按日历执行；待 LLM 与量化同向或校准明确后再考虑加减仓',
      },
    };
  }

  if (alignment === 'mild_gap') {
    banners.push(`🔢 双打分温和偏差：LLM=${llmScore} · 量化=${q} · 偏差=${delta > 0 ? '+' : ''}${delta}（同向）`);
    banners.push('   · 叙事看 LLM；短线结构可参考量化；操作仍宜克制');
    return {
      llmScore,
      quantScore: q,
      delta,
      alignment,
      llmDirection,
      quantDirection,
      sameDirection,
      actionPolicy: 'quant_preferred',
      banners,
      actionOverride: null,
    };
  }

  banners.push(`🔢 双打分一致：LLM=${llmScore} · 量化=${q} · 偏差=${delta > 0 ? '+' : ''}${delta}（均${dirLabel(llmDirection)}）`);
  return {
    llmScore,
    quantScore: q,
    delta,
    alignment: 'aligned',
    llmDirection,
    quantDirection,
    sameDirection: true,
    actionPolicy: 'both',
    banners,
    actionOverride: null,
  };
}

export function formatDualScoreConsole(v: DualScoreVerdict, indent = '  '): string {
  return v.banners.map(b => (b.startsWith(' ') ? `${indent}${b.trimStart()}` : `${indent}${b}`)).join('\n');
}

export function formatDualScoreMarkdown(v: DualScoreVerdict): string {
  const lines = [
    '## ⚖️ 双打分机制（LLM × 量化）',
    '',
    '| 体系 | 分数 | 方向 |',
    '|------|------|------|',
    `| LLM（四维+反驳+校准） | **${v.llmScore}/100** | ${dirLabel(v.llmDirection)} |`,
    `| 量化（纯本地因子） | **${v.quantScore ?? 'N/A'}/100** | ${v.quantDirection ? dirLabel(v.quantDirection) : 'N/A'} |`,
  ];
  if (v.delta != null) {
    lines.push(`| 偏差 (LLM−量化) | **${v.delta > 0 ? '+' : ''}${v.delta}** | ${v.alignment} |`);
  }
  lines.push('');
  lines.push(`- **对齐状态**：\`${v.alignment}\``);
  lines.push(`- **操作策略**：\`${v.actionPolicy}\``);
  if (v.actionOverride) {
    lines.push(`- ⛔ **操作覆盖**：${v.actionOverride.headline} — ${v.actionOverride.action}`);
  }
  for (const b of v.banners) {
    lines.push(`- ${b.replace(/^[🔢\s·]+/, '').trim()}`);
  }
  lines.push('');
  lines.push('> 双打分独立存在、分别校准（`snprush calibrate`）。冲突时弃权维持定投，不用「提高某一侧权重」掩盖分歧。');
  lines.push('');
  return lines.join('\n');
}

/** 方向命中：score>55 预测涨，<45 预测跌，中间不计入 */
export function predictDirectionFromScore(score: number): 'up' | 'down' | null {
  if (score > 55) return 'up';
  if (score < 45) return 'down';
  return null;
}
