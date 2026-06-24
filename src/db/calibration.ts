// 校准回测逻辑
import Database from 'better-sqlite3';
import { ReportsRepo, type AnalysisReportRow } from './reports.js';
import { IndexPricesRepo } from './index-prices.js';
import { ScenarioFeaturesRepo } from './scenario-features.js';
import type { CalibrationBucket, CalibrationReport, RiskAlertQuality } from '../types/calibration.js';
import type { Direction } from '../types/analysis.js';
import { SCORE_BUCKETS, scoreBucketRange } from '../utils/score-buckets.js';

export class CalibrationRepo {
  private reports: ReportsRepo;
  private prices: IndexPricesRepo;
  private features: ScenarioFeaturesRepo;

  constructor(private db: Database.Database) {
    this.reports = new ReportsRepo(db);
    this.prices = new IndexPricesRepo(db);
    this.features = new ScenarioFeaturesRepo(db);
  }

  backfillPending(): number {
    const pending = this.features.getPendingBackfill();
    let filled = 0;

    for (const feature of pending) {
      const report = this.reports.getByDate(feature.date);
      if (!report) continue;

      const priceOnDate = this.prices.getByDate(feature.date);
      if (!priceOnDate?.spxClose) continue;

      const after5d = this.prices.getAfter(feature.date, 5);
      const price5d = after5d.length >= 5 ? after5d[4] : after5d.length > 0 ? after5d[after5d.length - 1] : null;

      if (price5d?.spxClose) {
        const return5d = (price5d.spxClose - priceOnDate.spxClose) / priceOnDate.spxClose * 100;
        const direction5d = return5d > 0.1 ? 'up' : return5d < -0.1 ? 'down' : 'flat';

        const after20d = this.prices.getAfter(feature.date, 20);
        const price20d = after20d.length >= 20 ? after20d[19] : null;
        const return20d = price20d?.spxClose
          ? (price20d.spxClose - priceOnDate.spxClose) / priceOnDate.spxClose * 100
          : null;

        this.features.backfill(feature.id, return5d, direction5d, return20d);
        filled++;
      }
    }
    return filled;
  }

  computeCalibration(days: number, T: number = 5): CalibrationReport {
    const reports = this.reports.getRecent(days);
    const dateRange = reports.length > 0
      ? { from: reports[reports.length - 1].date, to: reports[0].date }
      : { from: 'N/A', to: 'N/A' };

    const buckets: CalibrationBucket[] = [];
    let totalValid = 0;

    for (const { range, min, max } of SCORE_BUCKETS) {
      const isLast = max === 100;
      const matching = reports.filter(r => r.overallScore >= min && (isLast ? r.overallScore <= max : r.overallScore < max));
      if (matching.length === 0) continue;

      let upCount = 0;
      let totalReturn = 0;
      let validCount = 0;

      for (const report of matching) {
        const currentPrice = this.prices.getByDate(report.date);
        const futurePrices = this.prices.getAfter(report.date, T);
        const futurePrice = futurePrices.length >= T ? futurePrices[T - 1] : null;

        if (!currentPrice?.spxClose || !futurePrice?.spxClose) continue;

        const futureReturn = (futurePrice.spxClose - currentPrice.spxClose) / currentPrice.spxClose * 100;
        if (futureReturn > 0) upCount++;
        totalReturn += futureReturn;
        validCount++;
      }

      if (validCount === 0) continue;
      totalValid += validCount;

      const avgReturn = totalReturn / validCount;
      const actualUpProbability = upCount / validCount;
      const midScore = (min + max) / 2;
      const calibrationError = Math.abs(midScore - actualUpProbability * 100);

      const predictedDirection: Direction = midScore > 50 ? 'bullish' : midScore < 50 ? 'bearish' : 'neutral';

      buckets.push({
        scoreRange: range,
        sampleSize: validCount,
        predictedDirection,
        actualUpCount: upCount,
        actualUpProbability,
        avgReturn,
        calibrationError,
        systematicBias: calibrationError < 5 ? 'calibrated'
          : midScore > actualUpProbability * 100 ? 'optimistic' : 'pessimistic',
      });
    }

    const overallBias = buckets.length > 0
      ? buckets.reduce((sum, b) => sum + (b.systematicBias === 'optimistic' ? b.calibrationError : b.systematicBias === 'pessimistic' ? -b.calibrationError : 0), 0) / buckets.length
      : 0;

    const riskAlertQuality = this.computeRiskAlertQuality(reports, T);

    const recommendations: string[] = [];
    const optimisticBuckets = buckets.filter(b => b.systematicBias === 'optimistic' && b.calibrationError > 10);
    if (optimisticBuckets.length > 0) {
      recommendations.push(`评分区间 ${optimisticBuckets.map(b => b.scoreRange).join('/')} 严重偏乐观，建议prompt中增加谨慎修正`);
    }
    if (riskAlertQuality.missedRate > 0.25) {
      recommendations.push(`漏报率 ${Math.round(riskAlertQuality.missedRate * 100)}%，建议增强反驳Agent强度`);
    }
    if (recommendations.length === 0) {
      recommendations.push('校准状态良好，继续保持');
    }

    return {
      period: { days, ...dateRange },
      totalReports: reports.length,
      validReports: totalValid,
      buckets,
      overallBias,
      riskAlertQuality,
      recommendations,
    };
  }

  private computeRiskAlertQuality(reports: AnalysisReportRow[], T: number): RiskAlertQuality {
    let redAlertCount = 0;
    let redAlertHitCount = 0;
    let missedAlerts = 0;
    let bigDropCount = 0;

    for (const report of reports) {
      const currentPrice = this.prices.getByDate(report.date);
      const futurePrices = this.prices.getAfter(report.date, T);
      const futurePrice = futurePrices.length >= T ? futurePrices[T - 1] : null;

      if (!currentPrice?.spxClose || !futurePrice?.spxClose) continue;

      const futureReturn = (futurePrice.spxClose - currentPrice.spxClose) / currentPrice.spxClose * 100;

      const isRedAlert = report.direction === 'bearish' && report.overallScore < 40;
      const isBigDrop = futureReturn < -2;

      if (isRedAlert) {
        redAlertCount++;
        if (isBigDrop) redAlertHitCount++;
      }

      if (isBigDrop) {
        bigDropCount++;
        if (!isRedAlert && report.overallScore > 60 && report.direction !== 'bearish') {
          missedAlerts++;
        }
      }
    }

    return {
      redAlertCount,
      redAlertHitCount,
      redAlertHitRate: redAlertCount > 0 ? redAlertHitCount / redAlertCount : 0,
      missedAlerts,
      missedRate: bigDropCount > 0 ? missedAlerts / bigDropCount : 0,
    };
  }

  getCalibrationContext(score: number): { scoreRange: string; historicalAccuracy: number | null; systematicBias: string; sampleSize: number } | null {
    const matchedRange = scoreBucketRange(score);
    if (!matchedRange) return null;

    const reports = this.reports.getByScoreRange(matchedRange.min, matchedRange.max, 90);
    if (reports.length < 5) {
      return {
        scoreRange: matchedRange.range,
        historicalAccuracy: null,
        systematicBias: '样本不足',
        sampleSize: reports.length,
      };
    }

    let upCount = 0;
    let valid = 0;
    for (const report of reports) {
      const currentPrice = this.prices.getByDate(report.date);
      const futurePrices = this.prices.getAfter(report.date, 5);
      const futurePrice = futurePrices.length >= 5 ? futurePrices[4] : null;
      if (!currentPrice?.spxClose || !futurePrice?.spxClose) continue;
      if ((futurePrice.spxClose - currentPrice.spxClose) / currentPrice.spxClose > 0) upCount++;
      valid++;
    }

    const accuracy = valid > 0 ? upCount / valid : null;
    const midScore = (matchedRange.min + matchedRange.max) / 2;
    const bias = accuracy !== null
      ? (midScore > accuracy * 100 ? '偏乐观' : midScore < accuracy * 100 ? '偏保守' : '校准良好')
      : '未知';

    return {
      scoreRange: matchedRange.range,
      historicalAccuracy: accuracy,
      systematicBias: bias,
      sampleSize: valid,
    };
  }
}
