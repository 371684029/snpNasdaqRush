// snprush calibrate — 回测校准

import { getDb } from '../db/index.js';
import { CalibrationRepo } from '../db/calibration.js';
import { header, separator } from '../utils/format.js';
import chalk from 'chalk';
import Table from 'cli-table3';
import type { CalibrateOptions } from '../types/config.js';

export async function calibrateCommand(options: CalibrateOptions): Promise<void> {
  console.log('\n📊 SnpRush 校准报告生成中...\n');

  const db = getDb();
  const repo = new CalibrationRepo(db);

  const filled = repo.backfillPending();
  if (filled > 0) {
    console.log(`  ✅ 回填了 ${filled} 条历史数据`);
  }

  const report = repo.computeCalibration(options.days);

  console.log(header('📊 SnpRush 置信度校准报告', `过去${report.period.days}天 | ${report.period.from} ~ ${report.period.to}`));
  console.log(`  分析报告总数: ${report.totalReports}条 | 有效回填: ${report.validReports}条`);

  if (report.buckets.length === 0) {
    console.log('\n  ⚠️ 暂无足够的历史数据进行校准');
    console.log('  请先运行 snprush analysis 多次积累数据');
    console.log(separator('═', 55));
    return;
  }

  // === cli-table3 表格 ===
  console.log(`\n  📈 评分区间校准\n`);
  const table = new Table({
    head: ['评分区间', '样本', '实际涨概率', '平均涨幅', '偏差', '系统偏差'],
    colWidths: [12, 8, 14, 12, 18, 12],
    style: { head: ['cyan'] },
  });

  for (const bucket of report.buckets) {
    const upPct = `${(bucket.actualUpProbability * 100).toFixed(0)}%`;
    const avgRet = bucket.avgReturn > 0 ? `+${bucket.avgReturn.toFixed(1)}%` : `${bucket.avgReturn.toFixed(1)}%`;
    const biasStr = bucket.systematicBias === 'optimistic'
      ? chalk.red(`偏乐观${bucket.calibrationError.toFixed(0)}%`)
      : bucket.systematicBias === 'pessimistic'
        ? chalk.green(`偏保守${bucket.calibrationError.toFixed(0)}%`)
        : chalk.cyan('校准良好');
    const systemBiasStr = bucket.systematicBias === 'optimistic' ? chalk.red('乐观')
      : bucket.systematicBias === 'pessimistic' ? chalk.green('保守')
        : chalk.cyan('校准');

    table.push([bucket.scoreRange, String(bucket.sampleSize), upPct, avgRet, biasStr, systemBiasStr]);
  }

  console.log(table.toString());

  // --detail：按评分区间展开明细
  if (options.detail) {
    console.log(`\n  🔍 区间明细\n`);
    for (const bucket of report.buckets) {
      console.log(`  ${bucket.scoreRange}: 预测方向=${bucket.predictedDirection} | 实际上涨 ${bucket.actualUpCount}/${bucket.sampleSize} | 校准误差 ${bucket.calibrationError.toFixed(1)}% | 系统偏差=${bucket.systematicBias}`);
    }
  }

  const biasDir = report.overallBias > 0 ? '偏乐观' : report.overallBias < 0 ? '偏保守' : '校准良好';
  console.log(`\n  ⚠️ 系统偏差: 整体${biasDir} ${Math.abs(report.overallBias).toFixed(1)}%`);

  const rq = report.riskAlertQuality;
  console.log(`\n  🚨 风险预警质量\n`);
  console.log(`  红灯触发: ${rq.redAlertCount}次`);
  console.log(`  红灯命中: ${rq.redAlertHitCount}次 (命中率${(rq.redAlertHitRate * 100).toFixed(0)}%) ${rq.redAlertHitRate > 0.6 ? '✅' : '⚠️'}`);
  console.log(`  漏报次数: ${rq.missedAlerts}次 (漏报率${(rq.missedRate * 100).toFixed(0)}%) ${rq.missedRate < 0.25 ? '✅' : '⚠️'}`);

  console.log(`\n  💡 改进建议`);
  for (const rec of report.recommendations) {
    console.log(`  · ${rec}`);
  }

  console.log(separator('═', 55));
}
