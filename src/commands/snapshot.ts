// snprush snapshot — 手动保存数据快照
// snprush init-history — 首次拉取历史数据

import { getDb } from '../db/index.js';
import { IndexPricesRepo } from '../db/index-prices.js';
import { DataCollectorAgent } from '../agents/data-collector.js';
import { todayDate } from '../utils/time.js';

export async function snapshotCommand(): Promise<void> {
  console.log('\n📸 保存数据快照...\n');

  const db = getDb();
  const repo = new IndexPricesRepo(db);

  const today = todayDate();
  const existing = repo.getByDate(today);

  if (existing) {
    console.log(`  ⚠️ ${today} 的数据已存在`);
    console.log(`  SPX: ${existing.spxClose ?? 'N/A'}`);
    console.log(`  IXIC: ${existing.ixicClose ?? 'N/A'}`);
    console.log(`  如需更新，请运行 snprush price`);
    return;
  }

  console.log('  采集当前市场数据...');
  const collector = new DataCollectorAgent();
  try {
    const marketData = await collector.collectMarketData();
    console.log('  ✅ 数据已自动保存到 SQLite');
    console.log(`  SPX: ${marketData.spx.price.value}`);
    console.log(`  IXIC: ${marketData.ixic.price.value}`);
  } catch (err) {
    console.error('  ❌ 采集失败:', err instanceof Error ? err.message : err);
  } finally {
    await collector.cleanup();
  }
}

export async function initHistoryCommand(): Promise<void> {
  console.log('\n📜 初始化历史数据 (最近60天)...\n');

  const db = getDb();
  const repo = new IndexPricesRepo(db);
  const existing = repo.count();

  console.log(`  当前已有 ${existing} 条历史数据`);

  if (existing >= 40) {
    console.log('  ✅ 历史数据已足够（≥40天）');
    return;
  }

  console.log('  正在通过搜索获取历史数据...');
  console.log('  ⚠️ 注意：历史数据依赖搜索结果，精度可能不如日常快照');

  const collector = new DataCollectorAgent();
  try {
    await collector.collectMarketData();
    console.log('  ✅ 当日数据已保存');
  } catch (err) {
    console.error('  ❌ 采集失败:', err instanceof Error ? err.message : err);
  } finally {
    await collector.cleanup();
  }

  const finalCount = repo.count();
  console.log(`\n  📊 现有 ${finalCount} 条历史数据`);
  console.log('  💡 建议：每天运行 snprush price，逐步积累数据');
  console.log('  💡 至少积累 20 天后，技术指标计算才能生效');
}
