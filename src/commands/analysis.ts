// snprush analysis — 综合分析报告

import { DataCollectorAgent } from '../agents/data-collector.js';
import { ValidatorAgent } from '../agents/validator.js';
import { TechnicalAgent, FundamentalAgent, SentimentAgent, EtfFundAgent } from '../agents/analysis-agents.js';
import { RebuttalAgent } from '../agents/rebuttal.js';
import { OrchestratorAgent } from '../agents/orchestrator.js';
import { header, separator, directionMark, scoreBar, changeColor, riskLevel, valuationMark } from '../utils/format.js';
import { formatNow } from '../utils/time.js';
import type { Horizon } from '../types/config.js';
import type { SnpAnalysisReport } from '../types/analysis.js';

export async function analysisCommand(options: { horizon: Horizon; json: boolean; save: boolean; md: boolean }): Promise<void> {
  console.log('\n🔬 SnpRush 综合分析启动...\n');

  // Step 1: 数据采集 + 验证
  console.log('  📡 Step 1: 采集市场数据...');
  const collector = new DataCollectorAgent();
  let marketData;
  try {
    marketData = await collector.collectMarketData();
  } catch (err) {
    console.error('数据采集失败:', err instanceof Error ? err.message : err);
    await collector.cleanup();
    return;
  }

  const validator = new ValidatorAgent();
  const validation = await validator.validate(marketData);
  console.log(`  ✅ 数据采集完成 (置信度: ${validation.overallConfidence}%)`);

  // Step 2: 四维度分析（串行执行，避免 LLM 并发争抢内存）
  console.log('  🧠 Step 2: 四维度分析...');
  console.log('  📊 分析中: 技术面...');
  const technical = await new TechnicalAgent().analyze(marketData);
  console.log(`  ✅ 技术面 ${technical.score}/100`);
  console.log('  📊 分析中: 基本面...');
  const fundamental = await new FundamentalAgent().analyze(marketData);
  console.log(`  ✅ 基本面 ${fundamental.score}/100`);

  console.log('  📊 分析中: 情绪面...');
  const sentiment = await new SentimentAgent().analyze(marketData);
  console.log(`  ✅ 情绪面 ${sentiment.score}/100`);
  console.log('  📊 分析中: ETF/板块面...');
  const etf = await new EtfFundAgent().analyze(marketData);
  console.log(`  ✅ ETF/板块面 ${etf.valuation.level}`);

  // Step 2.5: 强制反驳
  console.log('  ⚔️ Step 2.5: 强制反驳...');
  const rebuttalAgent = new RebuttalAgent();
  const rebuttal = await rebuttalAgent.rebut(technical, fundamental, sentiment, etf, marketData);
  console.log(`  ✅ 反驳完成 (看空力度: ${rebuttal.bearScore}/100, 强度: ${rebuttal.rebuttalStrength})`);

  // Step 3: 综合编排
  console.log('  🎯 Step 3: 综合编排...');
  const orchestrator = new OrchestratorAgent();
  const report = await orchestrator.orchestrate(marketData, technical, fundamental, sentiment, etf, rebuttal, options.horizon);
  console.log('  ✅ 编排完成');

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report, options.horizon);
  }

  if (options.save) {
    const filename = `snprush-analysis-${new Date().toISOString().slice(0, 10)}.json`;
    const fs = await import('node:fs');
    fs.writeFileSync(filename, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`\n💾 报告已保存到 ${filename}`);
  }

  if (options.md) {
    const fs = await import('node:fs');
    const docsDir = 'docs';
    if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
    const filename = `${docsDir}/snprush-analysis-${new Date().toISOString().slice(0, 10)}.md`;
    const mdContent = renderReportMarkdown(report, options.horizon);
    fs.writeFileSync(filename, mdContent, 'utf-8');
    console.log(`\n📝 报告已保存为 Markdown: ${filename}`);
  }

  await collector.cleanup();
  await validator.cleanup();
  await rebuttalAgent.cleanup();
  await orchestrator.cleanup();
}

function printReport(report: SnpAnalysisReport, horizon: Horizon): void {
  const { overall, technical, fundamental, sentiment, etf: etfAnalysis, rebuttal, tailRisks } = report;

  console.log(header('🎯 SnpRush 综合分析报告', formatNow()));

  const scoreDisplay = overall?.score ?? 'N/A';
  console.log(`\n  综合研判: ${directionMark(overall?.direction ?? 'neutral')} ${scoreDisplay}/100`);
  if (overall?.score) {
    console.log(`  ${scoreBar(overall.score)}`);
  }

  if (overall?.calibration?.historicalAccuracy !== null && overall?.calibration?.historicalAccuracy !== undefined) {
    console.log(`  📊 校准参考: ${overall.calibration.scoreRange}区间历史准确率${Math.round(overall.calibration.historicalAccuracy * 100)}% (${overall.calibration.systematicBias})`);
  }

  // 情景分析
  console.log(`\n  ⚡ 情景分析`);
  const scenarios = overall?.scenarios;
  if (scenarios) {
    console.log(`  基准 (${scenarios.base.probability}%): ${scenarios.base.description} → ${scenarios.base.action}`);
    console.log(`  上行 (${scenarios.upside.probability}%): ${scenarios.upside.description} (触发: ${scenarios.upside.trigger})`);
    console.log(`  下行 (${scenarios.downside.probability}%): ${scenarios.downside.description} (触发: ${scenarios.downside.trigger})`);
  }

  // 四维度摘要
  console.log(`\n  📈 四维度摘要`);
  console.log(`  技术面: ${technical.score}/100 ${directionMark(technical.direction)} — ${technical.summary}`);
  console.log(`  基本面: ${fundamental.score}/100 ${directionMark(fundamental.direction)} — ${fundamental.summary}`);
  console.log(`  情绪面: ${sentiment.score}/100 ${directionMark(sentiment.direction)} — ${sentiment.summary}`);
  console.log(`  ETF/板块: ${etfAnalysis.valuation.level} | 轮动: ${etfAnalysis.sectorRotation.rotationSignal}`);

  // 反驳摘要
  console.log(`\n  🔴 强制反驳摘要`);
  console.log(`  反驳强度: ${rebuttal.rebuttalStrength} | 看空力度: ${rebuttal.bearScore}/100`);
  for (const point of rebuttal.bearPoints.slice(0, 3)) {
    console.log(`  · ${point.point} (${point.probability}%概率)`);
  }
  for (const vul of rebuttal.bullVulnerabilities.slice(0, 2)) {
    console.log(`  · 看多漏洞: ${vul.vulnerability}`);
  }
  if (rebuttal.adjustedScore) {
    console.log(`  → 评分从初步${Math.round((technical.score + fundamental.score + sentiment.score) / 3)}分调整为${rebuttal.adjustedScore}分`);
  }

  // 双轨策略
  if (horizon !== 'mid' && overall?.shortTerm) {
    console.log(`\n  ⏱️ 短期策略 (日线级别)`);
    console.log(`  操作: ${overall.shortTerm.action ?? 'N/A'}`);
    console.log(`  SPX入场: ${overall.shortTerm.spxEntryZone ?? 'N/A'}`);
    console.log(`  IXIC入场: ${overall.shortTerm.ixicEntryZone ?? 'N/A'}`);
    console.log(`  目标: ${overall.shortTerm.target ?? 'N/A'}`);
    console.log(`  止损: ${overall.shortTerm.stopLoss ?? 'N/A'}`);
    console.log(`  品种: ${overall.shortTerm.recommendedProduct ?? 'N/A'}`);
    console.log(`  ⚠️ ${overall.shortTerm.riskWarning ?? 'N/A'}`);
  }

  if (horizon !== 'short' && overall?.midTerm) {
    console.log(`\n  📅 中长期策略 (周线级别)`);
    const mid = overall.midTerm;
    console.log(`  定投: ${mid.investAdvice?.dipInvest === 'increase' ? '加码' : mid.investAdvice?.dipInvest === 'pause' ? '暂停' : '继续'}`);
    console.log(`  仓位: ${mid.investAdvice?.positionAdjust === 'add' ? '加仓' : mid.investAdvice?.positionAdjust === 'reduce' ? '减仓' : '维持'}`);
    console.log(`  配置: ${mid.investAdvice?.recommendedFund ?? 'N/A'}`);
    console.log(`  SPX: ${mid.keyLevels?.spxSupportZone ?? 'N/A'} ~ ${mid.keyLevels?.spxResistanceZone ?? 'N/A'}`);
    console.log(`  IXIC: ${mid.keyLevels?.ixicSupportZone ?? 'N/A'} ~ ${mid.keyLevels?.ixicResistanceZone ?? 'N/A'}`);
    console.log(`  资产配置: ${mid.assetAllocation ?? 'N/A'}`);
    console.log(`  ⚠️ ${mid.riskWarning ?? 'N/A'}`);
  }

  // 尾部风险
  if (tailRisks.length > 0) {
    console.log(`\n  ⚠️ 尾部风险`);
    for (const risk of tailRisks) {
      console.log(`  ${risk.probability}% → ${risk.risk}: ${risk.impact} (触发: ${risk.trigger})`);
      console.log(`    对冲: ${risk.mitigation}`);
    }
    const noRisk = tailRisks.reduce((p, r) => p * (1 - r.probability / 100), 1);
    console.log(`  综合尾部风险指数: ${((1 - noRisk) * 100).toFixed(1)}%`);
  }

  console.log(separator('═', 55));
}

function renderReportMarkdown(report: SnpAnalysisReport, horizon: Horizon): string {
  const { overall, technical, fundamental, sentiment, etf: etfAnalysis, rebuttal, tailRisks, timestamp } = report;
  const lines: string[] = [];

  lines.push(`# 📊 SnpRush 综合分析报告`);
  lines.push(``);
  lines.push(`**生成时间**: ${timestamp}`);
  lines.push(`**视角**: ${horizon === 'short' ? '短期' : horizon === 'mid' ? '中长期' : '双视角（短期+中长期）'}`);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);

  const score = overall?.score ?? 'N/A';
  const dirMap: Record<string, string> = { bullish: '📈 看多', bearish: '📉 看空', neutral: '➡️ 中性' };
  lines.push(`## 🎯 综合研判`);
  lines.push(``);
  lines.push(`**评分**: ${score}/100`);
  lines.push(`**方向**: ${dirMap[overall?.direction ?? 'neutral'] ?? overall?.direction}`);
  lines.push(``);
  if (overall?.calibration?.historicalAccuracy != null) {
    lines.push(`**校准参考**: ${overall.calibration.scoreRange}区间历史准确率 ${Math.round(overall.calibration.historicalAccuracy * 100)}% (${overall.calibration.systematicBias})`);
    lines.push(``);
  }

  lines.push(`### ⚡ 情景分析`);
  lines.push(``);
  const scenarios = overall?.scenarios;
  if (scenarios) {
    lines.push(`| 情景 | 概率 | 描述 | SPX目标 | IXIC目标 | 操作/触发 |`);
    lines.push(`|------|------|------|---------|---------|-----------|`);
    lines.push(`| **基准** | ${scenarios.base.probability}% | ${scenarios.base.description} | ${scenarios.base.indexPrice} | ${scenarios.base.nasdaqPrice} | ${scenarios.base.action} |`);
    lines.push(`| **上行** | ${scenarios.upside.probability}% | ${scenarios.upside.description} | ${scenarios.upside.indexPrice} | ${scenarios.upside.nasdaqPrice} | 触发: ${scenarios.upside.trigger} |`);
    lines.push(`| **下行** | ${scenarios.downside.probability}% | ${scenarios.downside.description} | ${scenarios.downside.indexPrice} | ${scenarios.downside.nasdaqPrice} | 触发: ${scenarios.downside.trigger} |`);
  }
  lines.push(``);

  lines.push(`## 📈 四维度分析`);
  lines.push(``);

  // 技术面
  lines.push(`### 技术面 — ${technical.score}/100 — ${dirMap[technical.direction] ?? technical.direction}`);
  lines.push(``);
  lines.push(`${technical.summary}`);
  lines.push(``);
  lines.push(`**关键论点**:`);
  for (const kp of technical.keyPoints) lines.push(`- ${kp}`);
  lines.push(``);
  lines.push(`**反面论据**:`);
  for (const cp of technical.counterPoints) lines.push(`- ${cp}`);
  lines.push(``);
  lines.push(`**SPX** - 短期: ${technical.spx.shortTerm.keySignal} | 中长期: ${technical.spx.midTerm.keySignal}`);
  lines.push(`**IXIC** - 短期: ${technical.ixic.shortTerm.keySignal} | 中长期: ${technical.ixic.midTerm.keySignal}`);
  lines.push(`**相对强弱**: ${technical.relativeStrength}`);
  lines.push(`**板块轮动**: ${technical.sectorRotation}`);
  lines.push(``);

  // 基本面
  lines.push(`### 基本面 — ${fundamental.score}/100 — ${dirMap[fundamental.direction] ?? fundamental.direction}`);
  lines.push(``);
  lines.push(`${fundamental.summary}`);
  lines.push(``);
  for (const kp of fundamental.keyPoints) lines.push(`- ${kp}`);
  lines.push(``);
  lines.push(`- **估值**: ${fundamental.valuationLevel}`);
  lines.push(`- **盈利**: ${fundamental.earningsOutlook}`);
  lines.push(`- **美联储**: ${fundamental.fedPolicy}`);
  lines.push(`- **宏观**: ${fundamental.macroIndicators}`);
  lines.push(``);

  // 情绪面
  lines.push(`### 情绪面 — ${sentiment.score}/100 — ${dirMap[sentiment.direction] ?? sentiment.direction}`);
  lines.push(``);
  lines.push(`${sentiment.summary}`);
  lines.push(``);
  lines.push(`- **VIX**: ${sentiment.vixAnalysis}`);
  lines.push(`- **Put/Call**: ${sentiment.putCallRatio}`);
  lines.push(`- **资金流**: ${sentiment.fundFlows}`);
  lines.push(`- **机构持仓**: ${sentiment.institutionalPositions}`);
  lines.push(`- **市场宽度**: ${sentiment.marketBreadth}`);
  lines.push(``);

  // ETF面
  lines.push(`### ETF/板块面 — 估值: ${etfAnalysis.valuation.level}`);
  lines.push(``);
  lines.push(`**板块轮动**: ${etfAnalysis.sectorRotation.rotationSignal}`);
  lines.push(`**领涨**: ${etfAnalysis.sectorRotation.leading.join(', ')}`);
  lines.push(`**落后**: ${etfAnalysis.sectorRotation.lagging.join(', ')}`);
  lines.push(`**配置建议**:`);
  lines.push(`- 核心: ${etfAnalysis.recommendation.coreHold}`);
  lines.push(`- 成长: ${etfAnalysis.recommendation.growthFocus}`);
  lines.push(`- 价值: ${etfAnalysis.recommendation.valueFocus}`);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);

  // 反驳
  lines.push(`## 🔴 强制反驳`);
  lines.push(``);
  lines.push(`**反驳强度**: ${rebuttal.rebuttalStrength} | **看空力度**: ${rebuttal.bearScore}/100`);
  lines.push(``);
  lines.push(`### 看空论据`);
  for (const bp of rebuttal.bearPoints) {
    lines.push(`- **${bp.point}** (${bp.probability}%概率)`);
    lines.push(`  - 证据: ${bp.evidence}`);
    lines.push(`  - 影响: ${bp.impact}`);
  }
  lines.push(``);
  lines.push(`### 看多漏洞`);
  for (const vul of rebuttal.bullVulnerabilities) {
    lines.push(`- **${vul.vulnerability}**`);
    if (vul.originalPoint) lines.push(`  - 原论点: ${vul.originalPoint}`);
    if (vul.counterCondition) lines.push(`  - 反制条件: ${vul.counterCondition}`);
  }
  lines.push(``);
  if (rebuttal.adjustedScore) {
    lines.push(`**评分调整**: 初步 ${Math.round((technical.score + fundamental.score + sentiment.score) / 3)} → 修正 ${rebuttal.adjustedScore}`);
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(``);

  // 策略
  if (horizon !== 'mid' && overall?.shortTerm) {
    lines.push(`## ⏱️ 短期策略`);
    lines.push(``);
    lines.push(`| 项目 | 建议 |`);
    lines.push(`|------|------|`);
    lines.push(`| 操作 | ${overall.shortTerm.action} |`);
    lines.push(`| SPX入场 | ${overall.shortTerm.spxEntryZone} |`);
    lines.push(`| IXIC入场 | ${overall.shortTerm.ixicEntryZone} |`);
    lines.push(`| 目标 | ${overall.shortTerm.target} |`);
    lines.push(`| 止损 | ${overall.shortTerm.stopLoss} |`);
    lines.push(`| 品种 | ${overall.shortTerm.recommendedProduct} |`);
    lines.push(`| ⚠️ | ${overall.shortTerm.riskWarning} |`);
    lines.push(``);
  }

  if (horizon !== 'short' && overall?.midTerm) {
    const mid = overall.midTerm;
    lines.push(`## 📅 中长期策略`);
    lines.push(``);
    const dipMap: Record<string, string> = { increase: '加码定投', pause: '暂停定投', continue: '继续定投' };
    const posMap: Record<string, string> = { add: '加仓', reduce: '减仓', hold: '维持仓位' };
    lines.push(`| 项目 | 建议 |`);
    lines.push(`|------|------|`);
    lines.push(`| 定投 | ${dipMap[mid.investAdvice?.dipInvest] ?? mid.investAdvice?.dipInvest} |`);
    lines.push(`| 仓位 | ${posMap[mid.investAdvice?.positionAdjust] ?? mid.investAdvice?.positionAdjust} |`);
    lines.push(`| 配置 | ${mid.investAdvice?.recommendedFund} |`);
    lines.push(`| SPX | ${mid.keyLevels?.spxSupportZone} ~ ${mid.keyLevels?.spxResistanceZone} |`);
    lines.push(`| IXIC | ${mid.keyLevels?.ixicSupportZone} ~ ${mid.keyLevels?.ixicResistanceZone} |`);
    lines.push(`| 股债配置 | ${mid.assetAllocation} |`);
    lines.push(`| ⚠️ | ${mid.riskWarning} |`);
    lines.push(``);
  }

  // 尾部风险
  if (tailRisks.length > 0) {
    lines.push(`## ⚠️ 尾部风险`);
    lines.push(``);
    for (const risk of tailRisks) {
      lines.push(`### ${risk.probability}% — ${risk.risk}`);
      lines.push(`- **影响**: ${risk.impact}`);
      lines.push(`- **触发条件**: ${risk.trigger}`);
      lines.push(`- **对冲措施**: ${risk.mitigation}`);
      lines.push(``);
    }
    const noRisk = tailRisks.reduce((p, r) => p * (1 - r.probability / 100), 1);
    lines.push(`**综合尾部风险指数**: ${((1 - noRisk) * 100).toFixed(1)}%`);
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`*报告由 SnpRush 自动生成，仅供投资研究参考，不构成投资建议*`);

  return lines.join('\n');
}
