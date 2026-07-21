// Markdown 投资日报格式化器 — SnpRush 美股
//
// 纯函数、无副作用；对 LLM 可能缺失的字段做防御（缺失显示 N/A）。

import type { SnpAnalysisReport } from '../types/analysis.js';
import type { Horizon } from '../types/config.js';
import { computeTailRiskIndex } from './tail-risk.js';
import { getConfig } from './config.js';
import type { DataQualityGate } from './data-quality-gate.js';
import { formatDataQualityGateMarkdown } from './data-quality-gate.js';
import type { DualScoreVerdict } from './dual-score.js';
import { formatDualScoreMarkdown } from './dual-score.js';
import { formatQuantScoreMarkdown } from '../indicators/quant-score.js';
import type { PositionRecommendation } from './position-recommend.js';
import { formatPositionMarkdown } from './position-recommend.js';
import type { PredictionTrackStats } from './prediction-track.js';
import { formatPredictionTrackMarkdown } from './prediction-track.js';
import type { ReliabilityCard } from './reliability-card.js';
import { formatReliabilityMarkdown } from './reliability-card.js';
import type { ConsistencyCheck } from './plain-advice.js';
import { consistencyEmoji, resolveOperationalAdvice } from './plain-advice.js';

export interface ReportMarkdownExtras {
  dataQualityGate?: DataQualityGate;
  dualVerdict?: DualScoreVerdict;
  positionRec?: PositionRecommendation;
  predictionTrack?: PredictionTrackStats;
  reliabilityCard?: ReliabilityCard;
  consistency?: ConsistencyCheck;
}

function dirText(d: string | undefined): string {
  switch (d) {
    case 'bullish': return '📈 偏多';
    case 'bearish': return '📉 偏空';
    case 'neutral': return '➡️ 中性';
    default: return d ?? 'N/A';
  }
}

function pct(v: number | null | undefined): string {
  return v == null ? 'N/A' : `${v}%`;
}

function na<T>(v: T | null | undefined): string {
  return v == null || v === '' ? 'N/A' : String(v);
}

function horizonText(h: Horizon): string {
  return h === 'short' ? '仅短期视角' : h === 'mid' ? '仅中长期视角' : '双视角（短期 + 中长期）';
}

/** 将完整分析报告渲染为 Markdown 日报 */
export function formatReportMarkdown(
  report: SnpAnalysisReport,
  horizon: Horizon = 'all',
  extras?: ReportMarkdownExtras,
): string {
  const { overall, technical, fundamental, sentiment, etf, rebuttal } = report;
  const tailRisks = report.tailRisks ?? rebuttal?.tailRisks ?? [];
  const lines: string[] = [];

  lines.push('# 📊 SnpRush 美股投资日报');
  lines.push('');
  lines.push(`> 生成时间：${na(report.timestamp)}　|　视角：${horizonText(horizon)}　|　数据置信度：${na(report.dataQuality?.overallConfidence)}%`);
  lines.push('');

  const rel = extras?.reliabilityCard;
  if (rel) {
    lines.push(formatReliabilityMarkdown(rel));
  }

  const dq = extras?.dataQualityGate;
  if (dq) {
    lines.push(formatDataQualityGateMarkdown(dq));
  }

  const dual = extras?.dualVerdict;
  if (dual) {
    lines.push(formatDualScoreMarkdown(dual));
  } else if (overall?.quantScore != null) {
    const d = (overall.score ?? 0) - overall.quantScore;
    lines.push('## ⚖️ 双打分机制（LLM × 量化）');
    lines.push('');
    lines.push(`- LLM：**${na(overall.score)}/100** · 量化：**${overall.quantScore}/100** · 偏差：${d > 0 ? '+' : ''}${d}`);
    lines.push('');
  }

  if (overall?.quantFactors) {
    lines.push(formatQuantScoreMarkdown(overall.quantFactors, overall.quantScore));
  }

  const pos = extras?.positionRec;
  if (pos) {
    lines.push(formatPositionMarkdown(pos));
  }

  const predTrack = extras?.predictionTrack;
  if (predTrack) {
    lines.push(formatPredictionTrackMarkdown(predTrack));
  }

  // 综合研判
  lines.push('## 综合研判');
  lines.push('');
  if (rel) {
    lines.push(`- 综合评分：**${rel.scoreBand.low}–${rel.scoreBand.high}/100**（中心 ${rel.scoreBand.center}，${dirText(overall?.direction)}）`);
  } else {
    lines.push(`- 综合评分：**${na(overall?.score)}/100**（${dirText(overall?.direction)}）`);
  }
  const cons = extras?.consistency;
  if (cons) {
    lines.push(`- ${consistencyEmoji(cons.level)} 维度一致性：${cons.summary}`);
  }

  const opAdvice = resolveOperationalAdvice({
    llmScore: overall?.score,
    direction: overall?.direction,
    dataActionable: dq?.actionable,
    dualActionOverride: dual?.actionOverride ?? null,
    dualPolicy: dual?.actionPolicy ?? null,
    position: pos
      ? {
          headline: pos.headline,
          action: pos.action,
          emoji: pos.emoji,
          label: pos.label,
          tilt: pos.tilt,
          targetPct: pos.targetPct,
        }
      : null,
  });
  if (opAdvice) {
    const srcTag =
      opAdvice.source === 'data_gate' ? '⛔ 数据门禁'
        : opAdvice.source === 'dual_conflict' ? '⚖️ 双分弃权'
          : opAdvice.source === 'position' ? '📦 仓位'
            : '💡 评分';
    lines.push(`- **操作建议**（${srcTag}）：${opAdvice.emoji} ${opAdvice.headline}`);
    lines.push(`- **操作**：${opAdvice.action}`);
  } else if (dq?.tier === 'yellow') {
    lines.push('- ⚠️ **降级可用**：建议结合量化分与置信度阅读操作建议');
  }

  const cal = overall?.calibration;
  if (cal && cal.historicalAccuracy != null) {
    const pct5 = Math.round(cal.historicalAccuracy * 100);
    lines.push(`- 校准参考：${na(cal.scoreRange)} 区间 5日涨概率 ${pct5}%（${na(cal.systematicBias)}，样本 ${na(cal.sampleSize)}）`);
  } else if (cal?.systematicBias === '样本不足') {
    lines.push(`- 校准参考：样本不足（${na(cal.sampleSize)} 条），分数未经统计修正`);
  }
  if (overall?.quantScore !== undefined) {
    const diff = (overall.score ?? 0) - overall.quantScore;
    const absDiff = Math.abs(diff);
    const diffLabel = diff > 0 ? `LLM偏高 +${absDiff}` : diff < 0 ? `LLM偏低 -${absDiff}` : '一致';
    const diffEmoji = diff > 5 ? '⚠️' : diff < -5 ? '✅' : '➡️';
    lines.push(`- 🔢 量化评分: **${overall.quantScore}/100** | LLM: ${na(overall.score)}/100 | ${diffEmoji} ${diffLabel}`);
  }
  lines.push('');

  // 情景分析（含 SPX / IXIC 目标）
  const sc = overall?.scenarios;
  if (sc) {
    lines.push('## ⚡ 情景分析');
    lines.push('');
    lines.push('| 情景 | 概率 | 描述 | SPX目标 | IXIC目标 | 操作 | 触发条件 |');
    lines.push('|------|------|------|---------|----------|------|----------|');
    lines.push(`| 基准 | ${pct(sc.base?.probability)} | ${na(sc.base?.description)} | ${na(sc.base?.indexPrice)} | ${na(sc.base?.nasdaqPrice)} | ${na(sc.base?.action)} | - |`);
    lines.push(`| 上行 | ${pct(sc.upside?.probability)} | ${na(sc.upside?.description)} | ${na(sc.upside?.indexPrice)} | ${na(sc.upside?.nasdaqPrice)} | ${na(sc.upside?.action)} | ${na(sc.upside?.trigger)} |`);
    lines.push(`| 下行 | ${pct(sc.downside?.probability)} | ${na(sc.downside?.description)} | ${na(sc.downside?.indexPrice)} | ${na(sc.downside?.nasdaqPrice)} | ${na(sc.downside?.action)} | ${na(sc.downside?.trigger)} |`);
    lines.push('');
  }

  // 四维度摘要
  lines.push('## 📈 四维度摘要');
  lines.push('');
  lines.push('| 维度 | 评分 | 方向 | 摘要 |');
  lines.push('|------|------|------|------|');
  lines.push(`| 技术面 | ${na(technical?.score)}/100 | ${dirText(technical?.direction)} | ${na(technical?.summary)} |`);
  lines.push(`| 基本面 | ${na(fundamental?.score)}/100 | ${dirText(fundamental?.direction)} | ${na(fundamental?.summary)} |`);
  lines.push(`| 情绪面 | ${na(sentiment?.score)}/100 | ${dirText(sentiment?.direction)} | ${na(sentiment?.summary)} |`);
  lines.push(`| ETF面 | - | - | 估值水位：${na(etf?.valuation?.level)}；核心：${na(etf?.recommendation?.coreHold)} |`);
  lines.push('');

  if (rebuttal) {
    lines.push('## 🔴 强制反驳');
    lines.push('');
    lines.push(`- 反驳强度：**${na(rebuttal.rebuttalStrength)}**　|　看空力度：${na(rebuttal.bearScore)}/100`);
    for (const p of (rebuttal.bearPoints ?? []).slice(0, 5)) {
      lines.push(`  - 看空论据：${na(p.point)}（${pct(p.probability)} 概率）`);
    }
    for (const v of (rebuttal.bullVulnerabilities ?? []).slice(0, 3)) {
      lines.push(`  - 看多漏洞：${na(v.vulnerability)}`);
    }
    if (rebuttal.adjustedScore != null) {
      lines.push(`- 评分修正：调整为 **${rebuttal.adjustedScore} 分**（${na(rebuttal.netEffect)}）`);
    }
    lines.push('');
  }

  if (horizon !== 'mid' && overall?.shortTerm) {
    const s = overall.shortTerm;
    lines.push('## ⏱️ 短期策略（日线级别）');
    lines.push('');
    lines.push(`- 操作：${na(s.action)}`);
    lines.push(`- SPX 入场区间：${na(s.spxEntryZone)}`);
    lines.push(`- IXIC 入场区间：${na(s.ixicEntryZone)}`);
    lines.push(`- 目标：${na(s.target)}　|　止损：${na(s.stopLoss)}`);
    lines.push(`- 推荐品种：${na(s.recommendedProduct)}`);
    lines.push(`- ⚠️ 风险提示：${na(s.riskWarning)}`);
    lines.push('');
  }

  if (horizon !== 'short' && overall?.midTerm) {
    const m = overall.midTerm;
    lines.push('## 📅 中长期策略（周线级别）');
    lines.push('');
    lines.push(`- 定投建议：${na(m.investAdvice?.dipInvest)}　|　仓位调整：${na(m.investAdvice?.positionAdjust)}`);
    lines.push(`- 推荐标的：${na(m.investAdvice?.recommendedFund)}`);
    lines.push(`- SPX 支撑/阻力：${na(m.keyLevels?.spxSupportZone)} / ${na(m.keyLevels?.spxResistanceZone)}`);
    lines.push(`- IXIC 支撑/阻力：${na(m.keyLevels?.ixicSupportZone)} / ${na(m.keyLevels?.ixicResistanceZone)}`);
    lines.push(`- 股债配置：${na(m.assetAllocation)}`);
    lines.push(`- ⚠️ 风险提示：${na(m.riskWarning)}`);
    lines.push('');
  }

  if (tailRisks.length > 0) {
    lines.push('## ⚠️ 尾部风险');
    lines.push('');
    lines.push('| 概率 | 风险 | 影响 | 触发条件 | 对冲建议 |');
    lines.push('|------|------|------|----------|----------|');
    for (const r of tailRisks) {
      lines.push(`| ${pct(r.probability)} | ${na(r.risk)} | ${na(r.impact)} | ${na(r.trigger)} | ${na(r.mitigation)} |`);
    }
    const maxCap = getConfig().investment.maxTailRiskIndex * 2.5;
    const { index, rawUnion } = computeTailRiskIndex(tailRisks, maxCap);
    lines.push('');
    lines.push(`综合尾部风险指数：**${index.toFixed(1)}%**`);
    if (rawUnion - index > 5) {
      lines.push(`> 注：朴素并概率 ${rawUnion.toFixed(1)}%，已做互斥修正`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('> 本报告由 SnpRush 自动生成，仅供投资研究参考，**不构成投资建议**。');
  lines.push('');

  return lines.join('\n');
}
