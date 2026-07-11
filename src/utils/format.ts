// 终端输出格式化

import chalk from 'chalk';

/** 分隔线 */
export function separator(char: string = '═', width: number = 55): string {
  return char.repeat(width);
}

/** 标题块 */
export function header(title: string, subtitle?: string, width: number = 55): string {
  const lines: string[] = [];
  lines.push(separator('═', width));
  lines.push(`  ${title}`);
  if (subtitle) {
    lines.push(`  ${chalk.gray(subtitle)}`);
  }
  lines.push(separator('═', width));
  return lines.join('\n');
}

/** 来源可信度标记 */
export function gradeMark(grade: 'A' | 'B' | 'C'): string {
  switch (grade) {
    case 'A': return chalk.green('✅ A级');
    case 'B': return chalk.yellow('⚠️ B级');
    case 'C': return chalk.red('❌ C级');
  }
}

/** 涨跌幅颜色 */
export function changeColor(value: number): string {
  if (value > 0) return chalk.red(`+${value.toFixed(2)}%`);
  if (value < 0) return chalk.green(`${value.toFixed(2)}%`);
  return chalk.gray('0.00%');
}

/** 方向标记 */
export function directionMark(direction: string): string {
  switch (direction) {
    case 'bullish': return chalk.red('📈 偏多');
    case 'bearish': return chalk.green('📉 偏空');
    case 'neutral': return chalk.gray('➡️ 中性');
    default: return direction;
  }
}

/** 评分条 — 带颜色渐变: ≥70绿色, 40-69黄色, <40红色 */
export function scoreBar(score: number, width: number = 20): string {
  const filled = Math.round(score / 100 * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const coloredBar = score >= 70 ? chalk.green(bar) : score >= 40 ? chalk.yellow(bar) : chalk.red(bar);
  const scoreLabel = score >= 70 ? chalk.green(`${score}/100`) : score >= 40 ? chalk.yellow(`${score}/100`) : chalk.red(`${score}/100`);
  return `${coloredBar} ${scoreLabel}`;
}

/** 耗时显示 */
export function elapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** 格式化金额 */
export function formatPrice(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 风险等级标记 */
export function riskLevel(level: 'high' | 'medium' | 'low'): string {
  switch (level) {
    case 'high': return chalk.red('🔴 高');
    case 'medium': return chalk.yellow('🟡 中');
    case 'low': return chalk.green('🟢 低');
  }
}

/** 估值水位标记 */
export function valuationMark(level: 'low' | 'fair' | 'high'): string {
  switch (level) {
    case 'low': return chalk.green('偏低（适合加码定投）');
    case 'fair': return chalk.yellow('合理（维持定投）');
    case 'high': return chalk.red('偏高（考虑减仓）');
  }
}

/** 交易时段标记 */
export function sessionMark(session: string): string {
  switch (session) {
    case 'day': return chalk.green('● 盘中');
    case 'pre_market': return chalk.gray('○ 盘前');
    case 'after_hours': return chalk.gray('○ 盘后');
    case 'closed': return chalk.red('✕ 休市');
    default: return session;
  }
}

/** 指数对比表格行 */
export function indexRow(name: string, price: number, change: number): string {
  const priceStr = formatPrice(price).padStart(12);
  const changeStr = changeColor(change).padStart(10);
  return `  ${name.padEnd(14)} ${priceStr} ${changeStr}`;
}
