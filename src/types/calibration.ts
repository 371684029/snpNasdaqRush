// 校准回测类型定义

import type { Direction } from './analysis.js';

/** 校准分桶统计 */
export interface CalibrationBucket {
  scoreRange: string;           // "60-70", "70-80" 等
  sampleSize: number;
  predictedDirection: Direction;
  actualUpCount: number;
  actualUpProbability: number;  // 0-1
  avgReturn: number;            // 平均后续收益率 (%)
  calibrationError: number;
  systematicBias: 'optimistic' | 'pessimistic' | 'calibrated';
}

/** 风险预警质量 */
export interface RiskAlertQuality {
  redAlertCount: number;
  redAlertHitCount: number;
  redAlertHitRate: number;
  missedAlerts: number;
  missedRate: number;
}

/** 修正乘数校准 */
export interface MultiplierCalibration {
  weakMultiplier: number;
  moderateMultiplier: number;
  strongMultiplier: number;
  calibrationDate: string;
  sampleSize: number;
}

/** 校准报告 */
export interface CalibrationReport {
  period: {
    days: number;
    from: string;
    to: string;
  };
  totalReports: number;
  validReports: number;
  buckets: CalibrationBucket[];
  overallBias: number;
  riskAlertQuality: RiskAlertQuality;
  recommendations: string[];
}

/** 市场特征向量 */
export interface ScenarioFeature {
  id: number;
  date: string;
  reportId: number;
  dollarDirection: 'up' | 'down' | 'flat';
  dollarMagnitude: number;
  tipsDirection: 'up' | 'down' | 'flat';
  tipsMagnitude: number;
  vixLevel: number;
  fedStance: 'hawkish' | 'dovish' | 'neutral';
  momentumDirection: 'up' | 'down' | 'flat';
  consecutiveDays: number;
  actual5dReturn: number | null;
  actual5dDirection: 'up' | 'down' | 'flat' | null;
  actual20dReturn: number | null;
  backfillStatus: 'pending' | 'filled';
  createdAt: string;
}

/** 历史模式匹配结果 */
export interface PatternMatch {
  date: string;
  reportId: number;
  similarity: number; // 0-1
  direction: Direction;
  score: number;
  actualReturn: number | null;
  actual5dReturn: number | null;
}
