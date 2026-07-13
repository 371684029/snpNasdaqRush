// 近期报告上下文 — 注入 orchestrator prompt 提供历史记忆
// 对齐 goldRush report-history-context.ts

import { getDb } from '../db/index.js';
import { ReportsRepo } from '../db/reports.js';

export function buildRecentReportsContext(days: number = 30): string {
  try {
    const db = getDb();
    const repo = new ReportsRepo(db);
    const reports = repo.getRecent(days);
    if (reports.length < 2) return '';

    const recent = reports.slice(0, 7); // 近 7 条
    const avgScore = Math.round(recent.reduce((s, r) => s + r.overallScore, 0) / recent.length);
    const firstScore = recent[recent.length - 1].overallScore;
    const lastScore = recent[0].overallScore;
    const trend = lastScore > firstScore + 3 ? '上升'
      : lastScore < firstScore - 3 ? '下降'
        : '持平';

    const directionCounts: Record<string, number> = {};
    for (const r of recent) {
      directionCounts[r.direction] = (directionCounts[r.direction] || 0) + 1;
    }

    const lines: string[] = [
      `## 最近 ${recent.length} 次分析趋势`,
      `- 平均评分: ${avgScore}/100`,
      `- 评分趋势: ${trend}（${firstScore} → ${lastScore}）`,
      `- 方向分布: ${Object.entries(directionCounts).map(([d, c]) => `${d} ${c}次`).join('，')}`,
      `- 最新 3 次: ${recent.slice(0, 3).map(r => `${r.date.slice(5)} ${r.overallScore}/${r.direction}`).join(' → ')}`,
    ];
    return lines.join('\n');
  } catch {
    return '';
  }
}
