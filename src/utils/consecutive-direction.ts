// 连续方向跟踪 — 用于 scenario_features 动量特征
// 对齐 goldRush consecutive-direction.ts

import { getDb } from '../db/index.js';
import { ReportsRepo } from '../db/reports.js';

export function countConsecutiveDirectionDays(direction: string, lookback: number = 5): number {
  try {
    const db = getDb();
    const repo = new ReportsRepo(db);
    const recent = repo.getRecent(Math.max(lookback, 14));
    let count = 0;
    for (const r of recent) {
      if (r.direction === direction) count++;
      else break;
    }
    return count;
  } catch {
    return 0;
  }
}
