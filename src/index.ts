#!/usr/bin/env node
// SnpRush — 标普500 & 纳斯达克 投资研究 Agent CLI 入口

import { Command } from 'commander';
import { priceCommand } from './commands/price.js';
import { analysisCommand } from './commands/analysis.js';
import { etfCommand } from './commands/etf.js';
import { calibrateCommand } from './commands/calibrate.js';
import { snapshotCommand, initHistoryCommand } from './commands/snapshot.js';
import { historyCommand } from './commands/history.js';
import { diffCommand } from './commands/diff.js';
import { digestCommand } from './commands/digest.js';
import { outlookCommand } from './commands/outlook.js';
import { notifyCommand } from './commands/notify.js';
import { closeDb } from './db/index.js';
import { loadConfig } from './utils/config.js';

// 加载 dotenv
try {
  const dotenv = await import('dotenv');
  dotenv.config();
} catch { /* ignore */ }

// 加载配置
loadConfig();

const program = new Command();

program
  .name('snprush')
  .description('📊 SnpRush — 标普500 & 纳斯达克 投资研究 Agent')
  .version('0.1.0');

// P0: 实时指数行情
program
  .command('price')
  .description('实时指数行情速查（自动存SQLite）')
  .option('--detail', '更详细的数据')
  .action(async (opts) => {
    try {
      await priceCommand(opts.detail ?? false);
    } finally {
      closeDb();
    }
  });

// P1: 综合分析报告
program
  .command('analysis')
  .description('综合分析报告（默认输出双视角：短期 + 中长期）')
  .option('-H, --horizon <type>', '输出视角: short/mid/all', 'all')
  .option('--json', '输出 JSON 格式')
  .option('--save', '保存报告到文件 (JSON)')
  .option('--md', '保存报告为 Markdown 格式')
  .action(async (opts) => {
    const horizon = opts.horizon as 'short' | 'mid' | 'all';
    if (!['short', 'mid', 'all'].includes(horizon)) {
      console.error('❌ --horizon 必须是 short, mid 或 all');
      process.exit(1);
    }
    try {
      await analysisCommand({
        horizon,
        json: opts.json ?? false,
        save: opts.save ?? false,
        md: opts.md ?? false,
      });
    } finally {
      closeDb();
    }
  });

// P1: ETF 对比分析
program
  .command('etf')
  .description('ETF 对比分析（SPY/QQQ/VOO费率/溢价/配置建议）')
  .action(async () => {
    try {
      await etfCommand();
    } finally {
      closeDb();
    }
  });

// P1: 回测校准
program
  .command('calibrate')
  .description('回测校准（验证历史分析准确率）')
  .option('--days <n>', '回顾天数', '30')
  .option('--detail', '按评分区间细分校准')
  .action(async (opts) => {
    try {
      await calibrateCommand({
        days: parseInt(opts.days, 10) || 30,
        detail: opts.detail ?? false,
      });
    } finally {
      closeDb();
    }
  });

// P1: 数据管理
program
  .command('snapshot')
  .description('手动保存当日数据快照到SQLite')
  .action(async () => {
    try {
      await snapshotCommand();
    } finally {
      closeDb();
    }
  });

program
  .command('init-history')
  .description('首次运行：拉取最近60天历史数据')
  .action(async () => {
    try {
      await initHistoryCommand();
    } finally {
      closeDb();
    }
  });

program
  .command('history')
  .description('查看本地历史数据和报告')
  .option('--type <type>', '查看类型: prices/reports', 'prices')
  .option('--days <n>', '查看天数', '30')
  .action(async (opts) => {
    const type = opts.type as string;
    if (!['prices', 'reports'].includes(type)) {
      console.error('❌ --type 必须是 prices 或 reports');
      process.exit(1);
    }
    try {
      await historyCommand(type as 'prices' | 'reports', parseInt(opts.days, 10) || 30);
    } finally {
      closeDb();
    }
  });

// P2: 报告对比
program
  .command('diff')
  .description('对比两日分析报告变化')
  .argument('<dateA>', 'YYYY-MM-DD')
  .argument('<dateB>', 'YYYY-MM-DD')
  .option('--json', 'JSON 格式输出')
  .action((dateA, dateB, opts) => {
    try {
      diffCommand(dateA, dateB, opts.json ?? false);
    } finally {
      closeDb();
    }
  });

// P2: 周期摘要
program
  .command('digest')
  .description('周期摘要（均分、跳变等）')
  .option('--days <n>', '回顾天数', '7')
  .option('--json', 'JSON 格式输出')
  .option('--md', '写入 docs/')
  .action((opts) => {
    try {
      digestCommand(parseInt(opts.days, 10) || 7, opts.md ?? false, opts.json ?? false);
    } finally {
      closeDb();
    }
  });

// P2: 长期方向预期
program
  .command('outlook')
  .description('长期方向预期（1/3/5 年，基于最新分析报告）')
  .option('--json', 'JSON 输出')
  .option('--md', '写入 docs/snprush-outlook-latest.md')
  .action(async (opts) => {
    try {
      const code = outlookCommand({ json: opts.json ?? false, md: opts.md ?? false });
      if (code !== 0) process.exit(code);
    } finally {
      closeDb();
    }
  });

// P2: Webhook 告警
program
  .command('notify')
  .description('Webhook 告警（测试 / 每日任务结束）')
  .option('--test', '发送测试消息')
  .option('--daily', '每日分析结束后通知')
  .option('--exit <n>', '分析退出码（与 --daily 配合）', '0')
  .action(async (opts) => {
    try {
      await notifyCommand({
        test: opts.test ?? false,
        daily: opts.daily ?? false,
        exitCode: parseInt(opts.exit, 10) || 0,
      });
    } finally {
      closeDb();
    }
  });

program.parse();
