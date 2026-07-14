// snprush analysis — 综合分析报告

import { DataCollectorAgent } from '../agents/data-collector.js';
import { ValidatorAgent } from '../agents/validator.js';
import { TechnicalAgent, FundamentalAgent, SentimentAgent, EtfFundAgent } from '../agents/analysis-agents.js';
import { RebuttalAgent } from '../agents/rebuttal.js';
import { OrchestratorAgent } from '../agents/orchestrator.js';
import { header, separator, directionMark, scoreBar, elapsed } from '../utils/format.js';
import { formatNow } from '../utils/time.js';
import { IndexPricesRepo } from '../db/index-prices.js';
import { getDb } from '../db/index.js';
import { fetchYahooIndexDailyCloses } from '../data/yahoo-index-history.js';
import { buildScoreBreakdown, formatScoreBreakdownConsole } from '../utils/score-breakdown.js';
import { buildJudgeVerdict, formatJudgeVerdictConsole } from '../utils/judge-verdict.js';
import { detectMacroRegime, formatMacroRegimeLine } from '../utils/macro-regime.js';
import { buildLongTermOutlook, formatLongTermOutlookConsole } from '../utils/long-term-outlook.js';
import { matchCausalRules, formatCausalChainsConsole, type CausalContext } from '../utils/causal-rules.js';
import { buildRecentReportsContext } from '../utils/report-history-context.js';
import { scoreToAdvice, checkConsistency, type PlainAdvice } from '../utils/plain-advice.js';
import { ScenarioFeaturesRepo } from '../db/scenario-features.js';
import type { Horizon } from '../types/config.js';
import type { SnpAnalysisReport } from '../types/analysis.js';

export async function analysisCommand(options: { horizon: Horizon; json: boolean; save: boolean; md: boolean }): Promise<void> {
  console.log('\n🔬 SnpRush 综合分析启动...\n');

  const stepTimes: { step: string; ms: number }[] = [];
  const tick = (label: string) => { stepTimes.push({ step: label, ms: Date.now() }); };
  tick('start');

  // Step 0: 自动回填历史数据（确保校准有样本）
  try {
    const db = getDb();
    const priceRepo = new IndexPricesRepo(db);
    if (priceRepo.count() < 10) {
      console.log('  📥 Step 0: 历史数据不足，自动回填 Yahoo 日线...');
      const rows = await fetchYahooIndexDailyCloses(120);
      let saved = 0;
      for (const row of rows) {
        try {
          priceRepo.upsert({
            date: row.date,
            spxClose: row.spxClose, spxHigh: null, spxLow: null, spxPe: null,
            ixicClose: row.ixicClose, ixicHigh: null, ixicLow: null,
            spyNav: null, spyChange: null, qqqNav: null, qqqChange: null,
            vix: null, dollarIndex: null, us10yYield: null, us2yYield: null, tipsYield: null,
          });
          saved++;
        } catch { /* dupes */ }
      }
      console.log(`  ✅ 回填 ${saved} 条历史数据`);
    }
  } catch { /* backfill 失败不阻断分析 */ }

  // Step 1: 数据采集 + 验证
  console.log('  📡 Step 1: 采集市场数据...');
  const collector = new DataCollectorAgent();
  let marketData;
  try {
    marketData = await collector.collectMarketData();
  } catch (err) {
    console.error('数据采集失败:', err instanceof Error ? err.message : err);
    await collector.cleanup();
    process.exit(1);
    return;
  }

  const validator = new ValidatorAgent();
  const validation = await validator.validate(marketData);
  tick('data');
  console.log(`  ✅ 数据采集完成 (置信度: ${validation.overallConfidence}%)`);

  // Step 2: 四维度分析（技术+基本面并行，然后情绪+ETF并行）
  console.log('  🧠 Step 2: 四维度分析...');
  console.log('  📊 分析中: 技术面 + 基本面（并行）...');
  const [technical, fundamental] = await Promise.all([
    new TechnicalAgent().analyze(marketData),
    new FundamentalAgent().analyze(marketData),
  ]);
  console.log(`  ✅ 技术面 ${technical.score}/100 | 基本面 ${fundamental.score}/100`);

  console.log('  📊 分析中: 情绪面 + ETF/板块面（并行）...');
  const [sentiment, etf] = await Promise.all([
    new SentimentAgent().analyze(marketData),
    new EtfFundAgent().analyze(marketData),
  ]);
  console.log(`  ✅ 情绪面 ${sentiment.score}/100 | ETF/板块面 ${etf.valuation.level}`);
  tick('dims');

  // Step 2.5: 强制反驳
  console.log('  ⚔️ Step 2.5: 强制反驳...');
  const rebuttalAgent = new RebuttalAgent();
  const rebuttal = await rebuttalAgent.rebut(technical, fundamental, sentiment, etf, marketData);
  console.log(`  ✅ 反驳完成 (看空力度: ${rebuttal.bearScore}/100, 强度: ${rebuttal.rebuttalStrength})`);

  // === 本地规则层（无 LLM） ===
  // 宏观阶段检测
  const macroRegime = detectMacroRegime(marketData);

  // 因果链匹配
  const causalCtx: CausalContext = {
    dollarDirection: (marketData.dollarIndex?.value?.change ?? 0) > 0.3 ? 'up' : (marketData.dollarIndex?.value?.change ?? 0) < -0.3 ? 'down' : 'flat',
    dollarMagnitude: Math.abs(marketData.dollarIndex?.value?.change ?? 0),
    yield10y: marketData.usTreasury?.yield10y?.value ?? null,
    yield2y: marketData.usTreasury?.yield2y?.value ?? null,
    vix: marketData.vix?.value?.value ?? null,
    spxChange: marketData.spx?.price?.change ?? null,
    macroRegime: macroRegime?.tag ?? null,
  };
  const causalChains = matchCausalRules(causalCtx);

  // 近期报告历史
  const reportsContext = buildRecentReportsContext();

  // 研判裁决（纯规则，不依赖 LLM）
  const judgeBreakdown = buildScoreBreakdown(technical, fundamental, sentiment, rebuttal);
  const judgeVerdict = buildJudgeVerdict(technical, fundamental, sentiment, rebuttal, judgeBreakdown);

  // 长期方向预期
  const outlookInput = {
    technical, fundamental, sentiment, rebuttal,
    overallScore: Math.round((technical.score + fundamental.score + sentiment.score) / 3),
    overallDirection: (technical.score + fundamental.score + sentiment.score) / 3 >= 58 ? 'bullish' as const
      : (technical.score + fundamental.score + sentiment.score) / 3 <= 42 ? 'bearish' as const
        : 'neutral' as const,
    macroRegime: macroRegime ?? { tag: 'unknown', label: '未检测', description: '', direction: 'neutral' as const },
  };
  const longTermOutlook = buildLongTermOutlook(outlookInput);

  // 自然语言建议
  const advice = scoreToAdvice(Math.round((technical.score + fundamental.score + sentiment.score) / 3));
  const consistency = checkConsistency(
    { score: technical.score, direction: technical.direction },
    { score: fundamental.score, direction: fundamental.direction },
    { score: sentiment.score, direction: sentiment.direction },
  );

  // Step 3: 综合编排（含 try/catch fallback）
  console.log('  🎯 Step 3: 综合编排...');
  const orchestrator = new OrchestratorAgent();
  const orchCtx = {
    causalChainsText: causalChains.length ? causalChains.map((r: { label: string }) => `- ${r.label}`).join('\n') : undefined,
    reportsContext: reportsContext || undefined,
    macroRegimeLine: macroRegime ? formatMacroRegimeLine(macroRegime) : undefined,
  };
  let report: SnpAnalysisReport;
  try {
    report = await orchestrator.orchestrate(marketData, technical, fundamental, sentiment, etf, rebuttal, options.horizon, orchCtx);
  } catch (err) {
    console.error('  ⚠️ 编排失败，使用本地 fallback:');
    console.error('    ' + (err instanceof Error ? err.message : String(err)));
    // 构建 fallback report — 只用本地计算，不依赖 LLM
    const avg = Math.round((technical.score + fundamental.score + sentiment.score) / 3);
    report = {
      timestamp: new Date().toISOString(),
      marketData,
      dataQuality: { overallConfidence: 80, warnings: [] },
      technical, fundamental, sentiment,
      etf,
      rebuttal,
      tailRisks: rebuttal.tailRisks ?? [],
      overall: {
        score: avg,
        direction: avg >= 58 ? 'bullish' : avg <= 42 ? 'bearish' : 'neutral',
        scenarios: {
          base: { probability: 45, description: 'LLM 编排失败，基准情景采用均值估算', indexPrice: 'N/A', nasdaqPrice: 'N/A', action: '等待下一次分析', confidence: 'low' },
          upside: { probability: 30, description: '上行取决于 Q3 财报', indexPrice: 'N/A', nasdaqPrice: 'N/A', trigger: '科技财报超预期', action: '观望', confidence: 'low' },
          downside: { probability: 25, description: '下行取决于宏观恶化', indexPrice: 'N/A', nasdaqPrice: 'N/A', trigger: 'CPI/PCE 超预期', action: '观望', confidence: 'low' },
        },
        shortTerm: { horizon: 'short-term', action: '观望（LLM 编排失败）', spxEntryZone: 'N/A', ixicEntryZone: 'N/A', target: 'N/A', stopLoss: 'N/A', recommendedProduct: '等待下次分析', riskWarning: 'LLM 编排失败，策略不可用' },
        midTerm: { horizon: 'medium-term', investAdvice: { dipInvest: 'pause', positionAdjust: 'hold', recommendedFund: '等待' }, keyLevels: { spxSupportZone: 'N/A', spxResistanceZone: 'N/A', ixicSupportZone: 'N/A', ixicResistanceZone: 'N/A' }, assetAllocation: 'N/A', riskWarning: 'LLM 编排失败' },
        calibration: { scoreRange: 'N/A', historicalAccuracy: null, systematicBias: 'LLM 编排失败', sampleSize: 0 },
      },
    };
  }
  console.log('  ✅ 编排完成');
  tick('done');

  // 步骤耗时摘要
  const startMs = stepTimes.find(t => t.step === 'start')?.ms ?? 0;
  const dataMs = stepTimes.find(t => t.step === 'data')?.ms ?? startMs;
  const dimsMs = stepTimes.find(t => t.step === 'dims')?.ms ?? startMs;
  const doneMs = stepTimes.find(t => t.step === 'done')?.ms ?? startMs;
  console.log(`\n  ⏱️ 耗时: 数据${elapsed(dataMs - startMs)} + 分析${elapsed(dimsMs - dataMs)} + 编排${elapsed(doneMs - dimsMs)} → 总计${elapsed(doneMs - startMs)}`);

  // 覆盖数据质量（来自实际验证）
  report.dataQuality = {
    overallConfidence: validation.overallConfidence,
    warnings: validation.warnings,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report, options.horizon, advice, consistency, macroRegime, causalChains, judgeVerdict, longTermOutlook);
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

function printReport(
  report: SnpAnalysisReport,
  horizon: Horizon,
  advice: PlainAdvice,
  consistency: ReturnType<typeof checkConsistency>,
  macroRegime: ReturnType<typeof detectMacroRegime>,
  causalChains: ReturnType<typeof matchCausalRules>,
  judgeVerdict: ReturnType<typeof buildJudgeVerdict>,
  longTermOutlook: ReturnType<typeof buildLongTermOutlook>,
): void {
  const { overall, technical, fundamental, sentiment, etf: etfAnalysis, rebuttal, tailRisks } = report;

  // === 1. 标题 ===
  console.log(header('🎯 SnpRush 综合分析报告', formatNow()));

  // === 2. 评分构成（首位，对齐 goldRush）===
  try {
    const bd = buildScoreBreakdown(technical, fundamental, sentiment, rebuttal);
    console.log('\n' + formatScoreBreakdownConsole(bd, '  '));
  } catch { /* ignore */ }

  // === 3. 宏观阶段 ===
  if (macroRegime) {
    console.log(`\n  🌐 宏观阶段: ${formatMacroRegimeLine(macroRegime)}`);
  }

  // === 4. 因果链 ===
  if (causalChains.length > 0) {
    console.log('\n' + formatCausalChainsConsole(causalChains));
  }

  // === 5. 裁决摘要 ===
  console.log('\n' + formatJudgeVerdictConsole(judgeVerdict));

  // === 6. 历史相似日 [NEW] ===
  const similarText = buildSimilarPatternsConsole(report);
  if (similarText) console.log(similarText);

  // === 7. 长期方向预期 ===
  if (longTermOutlook) {
    console.log('\n' + formatLongTermOutlookConsole(longTermOutlook));
  }

  // === 8. 综合研判（分数 + 建议 + 一致性 + 校准）===
  const scoreDisplay = overall?.score ?? 'N/A';
  console.log(`\n  综合研判: ${directionMark(overall?.direction ?? 'neutral')} ${scoreDisplay}/100`);
  if (overall?.score) {
    console.log(`  ${scoreBar(overall.score)}`);
  }

  if (advice) {
    console.log(`\n  💡 ${advice.emoji} ${advice.headline}: ${advice.action}`);
  }

  // 一致性检查
  if (consistency && consistency.strength !== 'weak') {
    console.log(`  📊  📶 维度一致性: ${consistency.consensus === 'bullish' ? '技术面与基本面偏多' : consistency.consensus === 'bearish' ? '技术面与基本面偏空' : '各维度分歧'}`);
    if (consistency.dissenters.length > 0) console.log(`    分歧维度: ${consistency.dissenters.join('、')}`);
  }

  // 校准上下文（内联，对齐 goldRush）
  if (overall?.calibration?.historicalAccuracy != null) {
    console.log(`  📊 校准: ${overall.calibration.scoreRange}区间 5日涨概率${Math.round(overall.calibration.historicalAccuracy * 100)}% (${overall.calibration.systematicBias})`);
  }

  // === 9. 情景分析 ===
  console.log(`\n  ⚡ 情景分析`);
  const scenarios = overall?.scenarios;
  if (scenarios) {
    console.log(`  基准 (${scenarios.base.probability}%): ${scenarios.base.description} → ${scenarios.base.action}`);
    console.log(`  上行 (${scenarios.upside.probability}%): ${scenarios.upside.description} (触发: ${scenarios.upside.trigger})`);
    console.log(`  下行 (${scenarios.downside.probability}%): ${scenarios.downside.description} (触发: ${scenarios.downside.trigger})`);
  }

  // === 10. 四维度摘要 ===
  console.log(`\n  📈 四维度摘要`);
  console.log(`  技术面: ${technical.score}/100 ${directionMark(technical.direction)} — ${technical.summary}`);
  console.log(`  基本面: ${fundamental.score}/100 ${directionMark(fundamental.direction)} — ${fundamental.summary}`);
  console.log(`  情绪面: ${sentiment.score}/100 ${directionMark(sentiment.direction)} — ${sentiment.summary}`);
  console.log(`  ETF面: 估值${etfAnalysis.valuation.level} | 轮动: ${etfAnalysis.sectorRotation.rotationSignal}`);

  // === 11. 强制反驳摘要 ===
  console.log(`\n  🔴 强制反驳摘要`);
  console.log(`  反驳强度: ${rebuttal.rebuttalStrength} | 看空力度: ${rebuttal.bearScore}/100`);
  for (const point of (rebuttal.bearPoints ?? []).slice(0, 3)) {
    console.log(`  · ${point.point} (${point.probability}%概率)`);
  }
  for (const vul of (rebuttal.bullVulnerabilities ?? []).slice(0, 2)) {
    console.log(`  · 看多漏洞: ${vul.vulnerability}`);
  }
  if (rebuttal.adjustedScore) {
    console.log(`  → 详见上方「评分构成」明细`);
  }

  // === 12. 双轨策略 ===
  if (horizon !== 'mid' && overall?.shortTerm) {
    console.log(`\n  ⏱️ 短期策略 (日线级别)`);
    console.log(`  操作: ${overall.shortTerm.action ?? 'N/A'}`);
    console.log(`  入场: ${overall.shortTerm.spxEntryZone ?? 'N/A'}`);
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
    console.log(`  支撑区: ${mid.keyLevels?.spxSupportZone ?? 'N/A'}`);
    console.log(`  阻力区: ${mid.keyLevels?.spxResistanceZone ?? 'N/A'}`);
    console.log(`  ⚠️ ${mid.riskWarning ?? 'N/A'}`);
  }

  // === 13. 尾部风险 ===
  const tailRiskList = tailRisks ?? [];
  if (tailRiskList.length > 0) {
    console.log(`\n  ⚠️ 尾部风险`);
    for (const risk of tailRiskList) {
      console.log(`  ${risk.probability}% → ${risk.risk}: ${risk.impact} (触发: ${risk.trigger})`);
      console.log(`    对冲: ${risk.mitigation}`);
    }
    const noRisk = tailRiskList.reduce((p, r) => p * (1 - r.probability / 100), 1);
    console.log(`  综合尾部风险指数: ${((1 - noRisk) * 100).toFixed(1)}%`);
  }

  // === 14. 分隔线 ===
  console.log(separator('═', 55));
}

/** 历史相似日 — 从 scenario_features 找最近相似日 */
function buildSimilarPatternsConsole(report: SnpAnalysisReport): string {
  try {
    const db = getDb();
    const repo = new ScenarioFeaturesRepo(db);
    const features = repo.getRecent(200);
    if (features.length < 5) return '';
    // 简单相似：按 VIX 水平 + 美元方向匹配
    const currentVix = report.marketData?.vix?.value?.value ?? 20;
    const currentDxy = (report.marketData?.dollarIndex?.value?.change ?? 0) > 0.3 ? 'up' : (report.marketData?.dollarIndex?.value?.change ?? 0) < -0.3 ? 'down' : 'flat';
    const scored = features
      .map(f => ({
        date: f.date,
        vixDiff: Math.abs((f.vixLevel ?? 20) - currentVix),
        dollarMatch: f.dollarDirection === currentDxy ? 0 : 1,
        score: f.reportId ? (typeof f.reportId === 'string' ? 60 : 0) : 50,
      }))
      .sort((a, b) => (a.vixDiff + a.dollarMatch * 5) - (b.vixDiff + b.dollarMatch * 5))
      .slice(0, 5);
    const lines: string[] = ['\n  📜 历史相似日（Top 5）'];
    for (const s of scored) {
      lines.push(`  · ${s.date} (VIX偏差 ${s.vixDiff.toFixed(1)}, ${s.dollarMatch === 0 ? '美元同向' : '美元异向'})`);
    }
    return lines.join('\n');
  } catch { return ''; }
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
  for (const bp of (rebuttal.bearPoints ?? [])) {
    lines.push(`- **${bp.point}** (${bp.probability}%概率)`);
    lines.push(`  - 证据: ${bp.evidence}`);
    lines.push(`  - 影响: ${bp.impact}`);
  }
  lines.push(``);
  lines.push(`### 看多漏洞`);
  for (const vul of (rebuttal.bullVulnerabilities ?? [])) {
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
  const tailRiskList = tailRisks ?? [];
  if (tailRiskList.length > 0) {
    lines.push(`## ⚠️ 尾部风险`);
    lines.push(``);
    for (const risk of tailRiskList) {
      lines.push(`### ${risk.probability}% — ${risk.risk}`);
      lines.push(`- **影响**: ${risk.impact}`);
      lines.push(`- **触发条件**: ${risk.trigger}`);
      lines.push(`- **对冲措施**: ${risk.mitigation}`);
      lines.push(``);
    }
    const noRisk = tailRiskList.reduce((p, r) => p * (1 - r.probability / 100), 1);
    lines.push(`**综合尾部风险指数**: ${((1 - noRisk) * 100).toFixed(1)}%`);
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`*报告由 SnpRush 自动生成，仅供投资研究参考，不构成投资建议*`);

  return lines.join('\n');
}
