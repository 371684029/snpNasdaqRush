// snprush etf — ETF 对比分析

import { DataCollectorAgent } from '../agents/data-collector.js';
import { EtfFundAgent } from '../agents/analysis-agents.js';
import { header, separator, valuationMark } from '../utils/format.js';
import { formatNow } from '../utils/time.js';
import Table from 'cli-table3';

export async function etfCommand(): Promise<void> {
  console.log('\n💰 SnpRush ETF 分析启动...\n');

  const collector = new DataCollectorAgent();
  let marketData;
  try {
    marketData = await collector.collectMarketData();
  } catch (err) {
    console.error('数据采集失败:', err instanceof Error ? err.message : err);
    await collector.cleanup();
    return;
  }

  const etfAgent = new EtfFundAgent();
  const analysis = await etfAgent.analyze(marketData);

  console.log(header('💰 SnpRush ETF 对比分析', `${formatNow()} | 核心美股ETF`));

  // ETF 对比表格 — 使用 cli-table3
  console.log(`\n  📋 ETF 对比`);
  const table = new Table({
    head: ['代码', '净值', '费率', '规模', '股息', '建议'],
    colWidths: [10, 12, 10, 12, 10, 14],
    style: { head: ['cyan'] },
  });

  for (const f of analysis.comparisons) {
    table.push([f.code, f.nav.toFixed(2), `${f.feeRate}%`, `${f.aum}亿`, `${f.dividendYield}%`, f.recommendation]);
  }

  console.log(table.toString());

  // 估值水位
  console.log(`\n  📈 估值水位: ${valuationMark(analysis.valuation.level)}`);
  console.log(`  ${analysis.valuation.indicator}`);
  console.log(`  建议: ${analysis.valuation.action}`);

  // 板块轮动
  console.log(`\n  🔄 板块轮动`);
  console.log(`  信号: ${analysis.sectorRotation.rotationSignal}`);
  console.log(`  领涨: ${analysis.sectorRotation.leading.join(', ')}`);
  console.log(`  落后: ${analysis.sectorRotation.lagging.join(', ')}`);
  if (analysis.sectorRotation.defensiveShift) {
    console.log(`  ⚠️ 市场转向防御板块`);
  }

  // 推荐配置
  console.log(`\n${separator('━', 55)}`);
  console.log(`  🎯 推荐配置`);
  console.log(`  核心持仓: ${analysis.recommendation.coreHold}`);
  console.log(`  成长暴露: ${analysis.recommendation.growthFocus}`);
  console.log(`  价值风格: ${analysis.recommendation.valueFocus}`);
  console.log(`  逢跌定投: ${analysis.recommendation.dipBuy}`);
  console.log(separator('═', 55));

  await collector.cleanup();
  await etfAgent.cleanup();
}
