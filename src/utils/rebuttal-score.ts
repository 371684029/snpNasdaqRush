// 反驳评分修正 — 纯函数，可单测
// 对齐 apple-gold-rush：向 (100 - bearScore) 靠拢，而非错误抬高偏多分

import type { RebuttalAnalysis, RebuttalStrength } from '../types/analysis.js';

/** 默认强度乘数 */
export const STRENGTH_MULTIPLIER: Record<RebuttalStrength, number> = {
  weak: 0.10,
  moderate: 0.20,
  strong: 0.35,
};

export interface RebuttalAdjustmentDetail {
  adjustedScore: number;
  netEffect: RebuttalAnalysis['netEffect'];
  bearishImpliedScore: number;
  multiplier: number;
  rawAdjustment: number;
}

export interface MultiplierCalibrateInput {
  systematicBias?: string | null;
  calibrationError?: number | null;
  sampleSize?: number | null;
}

/**
 * 按历史校准偏差微调反驳强度乘数。
 * - 系统偏乐观 → 略增乘数（更用力压低乐观分）
 * - 系统偏悲观 → 略减乘数
 */
export function calibrateStrengthMultiplier(
  base: number,
  input?: MultiplierCalibrateInput | null,
): number {
  if (!input || (input.sampleSize ?? 0) < 5) return base;

  const bias = String(input.systematicBias ?? '').toLowerCase();
  const err = Math.max(0, Math.min(40, input.calibrationError ?? 0));
  const scale = Math.min(0.25, err / 100);

  let factor = 1;
  if (bias.includes('optimistic') || bias.includes('偏乐观') || bias.includes('乐观')) {
    factor = 1 + scale;
  } else if (bias.includes('pessimistic') || bias.includes('偏悲观') || bias.includes('悲观')) {
    factor = 1 - scale;
  } else {
    return base;
  }

  const next = base * factor;
  return Math.max(0.05, Math.min(0.50, Math.round(next * 1000) / 1000));
}

/** 计算反驳修正明细 */
export function computeRebuttalAdjustment(
  originalScore: number,
  bearScore: number,
  rebuttalStrength: RebuttalStrength,
  calibrate?: MultiplierCalibrateInput | null,
): RebuttalAdjustmentDetail {
  const baseMult = STRENGTH_MULTIPLIER[rebuttalStrength];
  const multiplier = calibrateStrengthMultiplier(baseMult, calibrate);
  const bearishImpliedScore = 100 - bearScore;
  const rawAdjustment = (bearishImpliedScore - originalScore) * multiplier;
  const adjustedScore = Math.max(0, Math.min(100, Math.round(originalScore + rawAdjustment)));

  const absAdjust = Math.abs(rawAdjustment);
  let netEffect: RebuttalAnalysis['netEffect'];
  if (absAdjust < 1) {
    netEffect = 'unchanged';
  } else if (rawAdjustment < 0) {
    netEffect = absAdjust < 5 ? 'downgraded' : 'significant_downgrade';
  } else {
    netEffect = 'unchanged';
  }

  return { adjustedScore, netEffect, bearishImpliedScore, multiplier, rawAdjustment };
}

/**
 * 将 bearScore（看空力度）映射到「隐含综合分」(100-bear)，再按强度向该目标靠拢。
 * 旧公式 (bearScore - originalScore) 在 bearScore > originalScore 时会错误抬高偏多分。
 */
export function adjustScoreWithRebuttal(
  originalScore: number,
  bearScore: number,
  rebuttalStrength: RebuttalStrength,
  calibrate?: MultiplierCalibrateInput | null,
): { adjustedScore: number; netEffect: RebuttalAnalysis['netEffect'] } {
  const { adjustedScore, netEffect } = computeRebuttalAdjustment(
    originalScore, bearScore, rebuttalStrength, calibrate,
  );
  return { adjustedScore, netEffect };
}
