// snprush history — 查看本地历史数据/报告

import { getDb } from '../db/index.js';
import { IndexPricesRepo } from '../db/index-prices.js';
import { ReportsRepo } from '../db/reports.js';
import { header, separator, directionMark, formatPrice } from '../utils/format.js';
import Table from 'cli-table3';

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

    const table = new Table({
      head: ['日期', 'SPX', 'IXIC', 'SPY', 'VIX'],
      colWidths: [14, 14, 14, 10, 8],
      style: { head: ['cyan'] },
    });

    for (const r of records.slice(-20)) {
      const spx = r.spxClose ? formatPrice(r.spxClose) : 'N/A';
      const ixic = r.ixicClose ? formatPrice(r.ixicClose) : 'N/A';
      const spy = r.spyNav ? r.spyNav.toFixed(2) : 'N/A';
      const vix = r.vix ? r.vix.toFixed(2) : 'N/A';
      table.push([r.date, spx, ixic, spy, vix]);
    }

    console.log(table.toString());
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

    const table = new Table({
      head: ['日期', '评分', '方向', '视角'],
      colWidths: [14, 10, 10, 8],
      style: { head: ['cyan'] },
    });

    for (const r of reports) {
      table.push([r.date, `${r.overallScore}/100`, directionMark(r.direction), r.horizon]);
    }

    console.log(table.toString());
    console.log(separator('═', 45));
  }
}
