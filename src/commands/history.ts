// snprush history — 查看本地历史数据/报告

import { getDb } from '../db/index.js';
import { IndexPricesRepo } from '../db/index-prices.js';
import { ReportsRepo } from '../db/reports.js';
import { header, separator, directionMark, changeColor, formatPrice } from '../utils/format.js';

export async function historyCommand(type: 'prices' | 'reports' = 'prices', days: number = 30): Promise<void> {
  const db = getDb();

  if (type === 'prices') {
    const repo = new IndexPricesRepo(db);
    const records = repo.getRecent(days);

    console.log(header('📜 SnpRush 历史指数', `最近${days}天 | 共${records.length}条`));

    if (records.length === 0) {
      console.log('\n  ⚠️ 暂无历史数据');
      console.log('  请运行 snprush price 或 snprush snapshot 积累数据');
      return;
    }

    console.log('\n  日期         SPX         IXIC        SPY     VIX');
    console.log(separator('─', 55));

    for (const r of records.slice(-20)) {
      const spx = r.spxClose ? formatPrice(r.spxClose) : 'N/A';
      const ixic = r.ixicClose ? formatPrice(r.ixicClose) : 'N/A';
      const spy = r.spyNav ? r.spyNav.toFixed(2) : 'N/A';
      const vix = r.vix ? r.vix.toFixed(2) : 'N/A';

      console.log(`  ${r.date}  ${spx.padStart(12)}  ${ixic.padStart(12)}  ${spy.padStart(7)}  ${vix.padStart(6)}`);
    }

    console.log(separator('═', 55));
  } else {
    const repo = new ReportsRepo(db);
    const reports = repo.getRecent(days);

    console.log(header('📜 SnpRush 历史报告', `最近${days}天 | 共${reports.length}条`));

    if (reports.length === 0) {
      console.log('\n  ⚠️ 暂无历史报告');
      console.log('  请运行 snprush analysis 积累分析数据');
      return;
    }

    console.log('\n  日期         评分   方向     视角');
    console.log(separator('─', 45));

    for (const r of reports) {
      console.log(`  ${r.date}  ${String(r.overallScore).padStart(3)}/100  ${directionMark(r.direction)}  ${r.horizon}`);
    }

    console.log(separator('═', 45));
  }
}
