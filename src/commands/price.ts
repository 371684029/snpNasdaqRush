// snprush price — 实时指数行情

import { DataCollectorAgent } from '../agents/data-collector.js';
import { ValidatorAgent } from '../agents/validator.js';
import { header, gradeMark, changeColor, formatPrice, sessionMark, separator, indexRow } from '../utils/format.js';
import { getTradingTime, formatNow } from '../utils/time.js';
import type { MarketData } from '../types/market.js';

export async function priceCommand(detail: boolean = false): Promise<void> {
  console.log('\n📊 正在采集美股指数数据...\n');

  const collector = new DataCollectorAgent();
  let marketData: MarketData;

  try {
    marketData = await collector.collectMarketData();
  } catch (err) {
    console.error('数据采集失败:', err instanceof Error ? err.message : err);
    console.log('\n⚠️ 降级提示');
    console.log(header('📊 SnpRush 实时指数', `${formatNow()} | 数据采集失败`));
    console.log('\n  数据采集遇到问题，请检查：');
    console.log('  1. opencode SDK 是否正常运行');
    console.log('  2. TAVILY_API_KEY 是否已设置（可选）');
    console.log('  3. 网络连接是否正常');
    await collector.cleanup();
    return;
  }

  const validator = new ValidatorAgent();
  const validation = await validator.validate(marketData);

  const tradingTime = getTradingTime();
  const dataTime = new Date(marketData.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  console.log(header('📊 SnpRush 实时指数', `${formatNow()} ET | ${sessionMark(tradingTime.session)} ${tradingTime.description}`));

  // SPX
  if (marketData.spx.price.value) {
    console.log(indexRow('标普500 (SPX)', marketData.spx.price.value, marketData.spx.price.change));
    console.log(`    高: ${formatPrice(marketData.spx.high?.value ?? 0).padStart(12)} 低: ${formatPrice(marketData.spx.low?.value ?? 0).padStart(12)}`);
    if (marketData.spx.pe?.value) console.log(`    PE: ${marketData.spx.pe.value.toFixed(2)} | 股息: ${marketData.spx.dividend?.value?.toFixed(2) ?? 'N/A'}%`);
  }

  // IXIC
  if (marketData.ixic.price.value) {
    console.log(indexRow('纳斯达克 (IXIC)', marketData.ixic.price.value, marketData.ixic.price.change));
    console.log(`    高: ${formatPrice(marketData.ixic.high?.value ?? 0).padStart(12)} 低: ${formatPrice(marketData.ixic.low?.value ?? 0).padStart(12)}`);
  }

  console.log(separator('─', 55));

  // ETF
  if (marketData.spy.nav?.value) {
    console.log(`  SPY: ${marketData.spy.nav.value.toFixed(2)} ${changeColor(marketData.spy.nav.change)}`);
  }
  if (marketData.qqq.nav?.value) {
    console.log(`  QQQ: ${marketData.qqq.nav.value.toFixed(2)} ${changeColor(marketData.qqq.nav.change)}`);
  }

  // VIX
  if (marketData.vix?.value?.value) {
    console.log(`  VIX: ${marketData.vix.value.value.toFixed(2)} ${changeColor(marketData.vix.value.change)}`);
  }

  // 其他
  if (marketData.dollarIndex.value?.value) {
    console.log(`  DXY: ${marketData.dollarIndex.value.value.toFixed(2)} ${changeColor(marketData.dollarIndex.value.change)}`);
  }
  if (marketData.usTreasury.yield10y?.value) {
    console.log(`  10Y: ${marketData.usTreasury.yield10y.value.toFixed(2)}% | 2Y: ${marketData.usTreasury.yield2y?.value?.toFixed(2) ?? 'N/A'}%`);
  }

  // 数据质量
  console.log(separator('─', 55));
  console.log(`  数据时间: ${dataTime}`);
  console.log(`  整体置信度: ${validation.overallConfidence}%`);
  if (validation.warnings.length > 0) {
    for (const w of validation.warnings) {
      console.log(`  ${w}`);
    }
  }
  console.log(separator('═', 55));

  await collector.cleanup();
  await validator.cleanup();
}
