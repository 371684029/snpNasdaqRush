// 周报 / 周期摘要 — 快速浏览多日分析变化

import type { AnalysisReportRow } from '../db/reports.js';
import { diffReports } from './report-diff.js';
import type { SnpAnalysisReport } from '../types/analysis.js';

export interface WeeklyDigest {
  days: number;
  from: string;
  to: string;
  reportCount: number;
  avgScore: number;
  scoreMin: number;
  scoreMax: number;
  bullishDays: number;
  bearishDays: number;
  neutralDays: number;
  largestSwing: { dateA: string; dateB: string; delta: number } | null;
  headline: string;
  bullets: string[];
}

function dirCn(d: string): string {
  if (d === 'bullish') return '偏多';
  if (d === 'bearish') return '偏空';
  return '中性';
}

export function buildWeeklyDigest(
  reports: AnalysisReportRow[],
  days: number,
): WeeklyDigest {
  const sorted = [...reports].sort((a, b) => a.date.localeCompare(b.date));

  if (sorted.length === 0) {
    return {
      days,
      from: 'N/A',
      to: 'N/A',
      reportCount: 0,
      avgScore: 0,
      scoreMin: 0,
      scoreMax: 0,
      bullishDays: 0,
      bearishDays: 0,
      neutralDays: 0,
      largestSwing: null,
      headline: '暂无报告数据',
      bullets: ['请先运行 snprush analysis 积累日报'],
    };
  }

  const scores = sorted.map(r => r.overallScore);
  const minS = Math.min(...scores);
  const maxS = Math.max(...scores);
  const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  let largestSwing: WeeklyDigest['largestSwing'] = null;
  let maxAbs = 0;

  for (let i = 1; i < sorted.length; i++) {
    const delta = sorted[i].overallScore - sorted[i - 1].overallScore;
    if (Math.abs(delta) > maxAbs) {
      maxAbs = Math.abs(delta);
      largestSwing = { dateA: sorted[i - 1].date, dateB: sorted[i].date, delta };
    }
  }

  const bullishDays = sorted.filter(r => r.direction === 'bullish').length;
  const bearishDays = sorted.filter(r => r.direction === 'bearish').length;
  const neutralDays = sorted.length - bullishDays - bearishDays;

  const trend =
    sorted.length >= 2 && sorted[sorted.length - 1].overallScore > sorted[0].overallScore
      ? '走高'
      : sorted.length >= 2 && sorted[sorted.length - 1].overallScore < sorted[0].overallScore
        ? '走低'
        : '震荡';

  const headline =
    `过去 ${days} 天 ${sorted.length} 份报告，均分 ${avgScore}（${minS}–${maxS}），评分整体${trend}`;

  const bullets: string[] = [
    `看多 ${bullishDays} 天 · 中性 ${neutralDays} 天 · 看空 ${bearishDays} 天`,
    `最新 ${sorted[sorted.length - 1].date}：${sorted[sorted.length - 1].overallScore} 分（${dirCn(sorted[sorted.length - 1].direction)}）`,
  ];

  if (largestSwing && Math.abs(largestSwing.delta) >= 2) {
    bullets.push(
      `最大单日跳变：${largestSwing.dateA} → ${largestSwing.dateB}（${largestSwing.delta > 0 ? '+' : ''}${largestSwing.delta} 分）`,
    );
  }

  return {
    days,
    from: sorted[0].date,
    to: sorted[sorted.length - 1].date,
    reportCount: sorted.length,
    avgScore,
    scoreMin: minS,
    scoreMax: maxS,
    bullishDays,
    bearishDays,
    neutralDays,
    largestSwing,
    headline,
    bullets,
  };
}

export function enrichDigestWithDiff(
  digest: WeeklyDigest,
  reportA: SnpAnalysisReport | null,
  reportB: SnpAnalysisReport | null,
): WeeklyDigest {
  if (!reportA || !reportB || digest.from === 'N/A') return digest;
  const diff = diffReports(digest.from, digest.to, reportA, reportB);
  return {
    ...digest,
    bullets: [...digest.bullets, `首尾对比：${diff.headline}`],
  };
}

export function formatDigestConsole(digest: WeeklyDigest): string {
  const lines = [
    '',
    `📰 SnpRush 周期摘要（${digest.days} 天）`,
    `  ${digest.from} ~ ${digest.to}`,
    '',
    `  💡 ${digest.headline}`,
  ];
  for (const b of digest.bullets) {
    lines.push(`  · ${b}`);
  }
  lines.push('');
  lines.push('  💡 详细对比：snprush diff <旧日期> <新日期>');
  return lines.join('\n');
}

export function formatDigestMarkdown(digest: WeeklyDigest): string {
  const lines = [
    '# 📰 SnpRush 周期摘要',
    '',
    `> 区间：${digest.from} ~ ${digest.to}（${digest.days} 天）　|　报告 ${digest.reportCount} 份`,
    '',
    '## 概览',
    '',
    `- ${digest.headline}`,
  ];
  for (const b of digest.bullets) {
    lines.push(`- ${b}`);
  }
  lines.push('');
  lines.push('| 指标 | 数值 |');
  lines.push('|------|------|');
  lines.push(`| 平均分 | ${digest.avgScore} |`);
  lines.push(`| 区间 | ${digest.scoreMin} – ${digest.scoreMax} |`);
  lines.push(`| 看多/中性/看空 | ${digest.bullishDays} / ${digest.neutralDays} / ${digest.bearishDays} |`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('> 本摘要由 SnpRush 自动生成，不构成投资建议。');
  lines.push('');
  return lines.join('\n');
}
