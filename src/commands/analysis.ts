// snprush analysis — 综合分析报告（门禁 + 双打分 + 可信度 + 仓位）

import { DataCollectorAgent } from '../agents/data-collector.js';
import { ValidatorAgent } from '../agents/validator.js';
import { TechnicalAgent, FundamentalAgent, SentimentAgent, EtfFundAgent } from '../agents/analysis-agents.js';
import { RebuttalAgent } from '../agents/rebuttal.js';
import { OrchestratorAgent } from '../agents/orchestrator.js';
import { header, separator, directionMark, scoreBar, elapsed } from '../utils/format.js';
import { formatNow, todayDate } from '../utils/time.js';
import { IndexPricesRepo } from '../db/index-prices.js';
import { ReportsRepo } from '../db/reports.js';
import { getDb } from '../db/index.js';
import {
  ensureIndexPriceHistory,
  MIN_TRADING_ROWS_FOR_ANALYSIS,
} from '../utils/ensure-index-history.js';
import { forwardFillCloses } from '../utils/price-series.js';
import { computeQuantScore, formatQuantScoreConsole } from '../indicators/quant-score.js';
import { isValidMarketNumber } from '../schemas/market.js';
import {
  evaluateDataQualityGate,
  formatDataQualityGateConsole,
  nonActionableAdvice,
  type DataQualityGate,
} from '../utils/data-quality-gate.js';
import {
  evaluateDualScore,
  formatDualScoreConsole,
  type DualScoreVerdict,
} from '../utils/dual-score.js';
import {
  scoreToAdvice,
  checkConsistency,
  consistencyEmoji,
  resolveOperationalAdvice,
  type PlainAdvice,
  type ConsistencyCheck,
} from '../utils/plain-advice.js';
import {
  recommendPosition,
  formatPositionConsole,
  extractPreviousTargetPct,
  type PositionRecommendation,
} from '../utils/position-recommend.js';
import {
  buildReliabilityCard,
  formatReliabilityConsole,
  type ReliabilityCard,
} from '../utils/reliability-card.js';
import {
  buildPredictionTrackStats,
  writePredictionTrackJson,
  formatPredictionTrackConsole,
  type PredictionTrackStats,
} from '../utils/prediction-track.js';
import { formatReportMarkdown } from '../utils/report-md.js';
import { computeTailRiskIndex } from '../utils/tail-risk.js';
import { getConfig } from '../utils/config.js';
import { buildScoreBreakdown, formatScoreBreakdownConsole } from '../utils/score-breakdown.js';
import { buildJudgeVerdict, formatJudgeVerdictConsole } from '../utils/judge-verdict.js';
import { detectMacroRegime, formatMacroRegimeLine } from '../utils/macro-regime.js';
import { buildLongTermOutlook, formatLongTermOutlookConsole } from '../utils/long-term-outlook.js';
import { matchCausalRules, formatCausalChainsConsole, type CausalContext } from '../utils/causal-rules.js';
import { buildRecentReportsContext } from '../utils/report-history-context.js';
import { ScenarioFeaturesRepo } from '../db/scenario-features.js';
import type { Horizon } from '../types/config.js';
import type { SnpAnalysisReport } from '../types/analysis.js';

export interface AnalysisExtras {
  dataQualityGate?: DataQualityGate;
  dualVerdict?: DualScoreVerdict;
  positionRec?: PositionRecommendation;
  predictionTrack?: PredictionTrackStats;
  reliabilityCard?: ReliabilityCard;
  consistency?: ConsistencyCheck;
  advice?: PlainAdvice;
  macroRegime?: ReturnType<typeof detectMacroRegime>;
  causalChains?: ReturnType<typeof matchCausalRules>;
  judgeVerdict?: ReturnType<typeof buildJudgeVerdict>;
  longTermOutlook?: ReturnType<typeof buildLongTermOutlook>;
}

export async function analysisCommand(options: { horizon: Horizon; json: boolean; save: boolean; md: boolean }): Promise<void> {
  console.log('\n🔬 SnpRush 综合分析启动...\n');

  const stepTimes: { step: string; ms: number }[] = [];
  const tick = (label: string) => { stepTimes.push({ step: label, ms: Date.now() }); };
  tick('start');

  const db = getDb();
  const priceRepo = new IndexPricesRepo(db);

  // Step 0: 确保指数历史（≥20 交易日）
  console.log('  📜 Step 0: 补齐指数历史 (60 天)...');
  try {
    const hist = await ensureIndexPriceHistory(priceRepo, 60);
    if (hist.filled > 0) {
      console.log(`  ✅ Yahoo 已补 ${hist.filled} 个交易日（共 ${hist.tradingRows} 行，可算 MA/RSI/MACD）`);
    } else if (hist.readyForAnalysis) {
      console.log(`  ✅ 历史就绪（${hist.tradingRows} 个交易日）`);
    } else {
      console.log(`  ⚠️ 历史仅 ${hist.tradingRows} 行（需 ≥${MIN_TRADING_ROWS_FOR_ANALYSIS}），指标可能不完整`);
    }
  } catch (err) {
    console.warn('  ⚠️ 历史自动补齐失败:', err instanceof Error ? err.message : err);
  }

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

  // Step 1.5: 数据质量门禁
  const dataQualityGate = evaluateDataQualityGate({
    marketData,
    overallConfidence: validation.overallConfidence,
    validations: validation.validations,
    warnings: validation.warnings,
    anchorSpxPrice: collector.lastAnchorSpx,
  });
  console.log(formatDataQualityGateConsole(dataQualityGate));

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

  // Step 2.8: 量化评分
  const recentPrices = priceRepo.getRecent(120);
  const spxCloses = forwardFillCloses(recentPrices, 'spxClose');
  const ixicCloses = forwardFillCloses(recentPrices, 'ixicClose');
  const dxySeries = recentPrices
    .map(r => r.dollarIndex)
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  const us10ySeries = recentPrices
    .map(r => r.us10yYield)
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  const vixVal = marketData.vix?.value?.value;
  const quant = computeQuantScore({
    closes: spxCloses,
    ixicCloses,
    dxy: dxySeries.length >= 20 ? dxySeries : undefined,
    us10y: us10ySeries.length >= 20 ? us10ySeries : undefined,
    vix: isValidMarketNumber(vixVal) ? vixVal : undefined,
  });
  console.log(`  🔢 量化评分: ${quant.score}/100`);

  // === 本地规则层（无 LLM） ===
  const macroRegime = detectMacroRegime(marketData);
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
  const reportsContext = buildRecentReportsContext();
  const judgeBreakdown = buildScoreBreakdown(technical, fundamental, sentiment, rebuttal);
  const judgeVerdict = buildJudgeVerdict(technical, fundamental, sentiment, rebuttal, judgeBreakdown);
  const outlookInput = {
    technical, fundamental, sentiment, rebuttal,
    overallScore: Math.round((technical.score + fundamental.score + sentiment.score) / 3),
    overallDirection: (technical.score + fundamental.score + sentiment.score) / 3 >= 58 ? 'bullish' as const
      : (technical.score + fundamental.score + sentiment.score) / 3 <= 42 ? 'bearish' as const
        : 'neutral' as const,
    macroRegime: macroRegime ?? { tag: 'unknown', label: '未检测', description: '', direction: 'neutral' as const },
  };
  const longTermOutlook = buildLongTermOutlook(outlookInput);

  // Step 3: 综合编排（含 try/catch fallback）
  console.log('  🎯 Step 3: 综合编排...');
  const orchestrator = new OrchestratorAgent();
  const orchCtx = {
    causalChainsText: causalChains.length ? causalChains.map((r: { label: string }) => `- ${r.label}`).join('\n') : undefined,
    reportsContext: reportsContext || undefined,
    macroRegimeLine: macroRegime ? formatMacroRegimeLine(macroRegime) : undefined,
    quantScore: quant.score,
    quantFactors: quant.factors,
  };
  let report: SnpAnalysisReport;
  try {
    report = await orchestrator.orchestrate(marketData, technical, fundamental, sentiment, etf, rebuttal, options.horizon, orchCtx);
  } catch (err) {
    console.error('  ⚠️ 编排失败，使用本地 fallback:');
    console.error('    ' + (err instanceof Error ? err.message : String(err)));
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
        quantScore: quant.score,
        quantFactors: quant.factors,
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

  // 覆盖数据质量（来自实际验证 + 门禁）
  report.dataQuality = {
    overallConfidence: validation.overallConfidence,
    warnings: [
      ...(validation.warnings ?? []),
      ...dataQualityGate.banners.map(b => b.trim()),
    ],
  };
  report.overall.quantScore = quant.score;
  report.overall.quantFactors = quant.factors;

  // 一致性 / 双打分 / 仓位 / 可信度 / 预测对错
  const consistency = checkConsistency(
    { score: technical.score, direction: technical.direction },
    { score: fundamental.score, direction: fundamental.direction },
    { score: sentiment.score, direction: sentiment.direction },
  );
  const dualVerdict = evaluateDualScore(report.overall.score, quant.score, {
    consistencyWeak: consistency.level === 'weak',
    dataActionable: dataQualityGate.actionable,
  });
  if (!dataQualityGate.actionable) {
    applyNonActionableOverlay(report, dataQualityGate);
  } else if (dualVerdict.actionOverride) {
    applyDualHoldOverlay(report, dualVerdict);
  }

  const reportsRepo = new ReportsRepo(db);
  const today = todayDate();
  let previousTargetPct: number | null = null;
  try {
    for (const row of reportsRepo.getRecent(21)) {
      if (row.date >= today) continue;
      try {
        const prev = JSON.parse(row.reportJson) as unknown;
        previousTargetPct = extractPreviousTargetPct(prev);
        if (previousTargetPct != null) break;
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  const positionRec = recommendPosition({
    llmScore: report.overall.score,
    quantScore: quant.score,
    dataActionable: dataQualityGate.actionable,
    dualPolicy: dualVerdict.actionPolicy,
    consistencyLevel: consistency.level,
    direction: report.overall.direction,
    closes: spxCloses,
    previousTargetPct,
  });

  let predictionTrack: PredictionTrackStats | undefined;
  try {
    predictionTrack = buildPredictionTrackStats(db);
    const statsPath = writePredictionTrackJson(predictionTrack);
    console.log(formatPredictionTrackConsole(predictionTrack));
    console.log(`  💾 预测对错统计已写入: ${statsPath}`);
  } catch (err) {
    console.warn('  ⚠️ 预测对错统计失败:', err instanceof Error ? err.message : err);
  }

  const cal = report.overall.calibration;
  const reliabilityCard = buildReliabilityCard({
    llmScore: report.overall.score,
    direction: report.overall.direction,
    quantScore: quant.score,
    dataGate: dataQualityGate,
    dual: dualVerdict,
    consistency,
    calibrationSampleSize: cal?.sampleSize ?? null,
    calibrationBias: cal?.systematicBias ?? null,
    position: positionRec,
    trackHitRate: predictionTrack?.llm.hitRate != null
      ? predictionTrack.llm.hitRate / 100
      : null,
    trackSampleSize: predictionTrack?.llm.total ?? null,
  });

  const advice = scoreToAdvice(report.overall.score, report.overall.direction);

  const extras: AnalysisExtras = {
    dataQualityGate,
    dualVerdict,
    positionRec,
    predictionTrack,
    reliabilityCard,
    consistency,
    advice,
    macroRegime,
    causalChains,
    judgeVerdict,
    longTermOutlook,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report, options.horizon, extras);
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
    const mdContent = formatReportMarkdown(report, options.horizon, {
      dataQualityGate,
      dualVerdict,
      positionRec,
      predictionTrack,
      reliabilityCard,
      consistency,
    });
    fs.writeFileSync(filename, mdContent, 'utf-8');
    console.log(`\n📝 报告已保存为 Markdown: ${filename}`);
  }

  await collector.cleanup();
  await validator.cleanup();
  await rebuttalAgent.cleanup();
  await orchestrator.cleanup();
}

function applyNonActionableOverlay(report: SnpAnalysisReport, gate: DataQualityGate): void {
  const na = nonActionableAdvice();
  if (report.overall?.shortTerm) {
    report.overall.shortTerm.action = na.action;
    report.overall.shortTerm.riskWarning = `${na.headline}；原因：${gate.reasons.join('；')}`;
  }
  if (report.overall?.midTerm) {
    report.overall.midTerm.investAdvice = {
      ...report.overall.midTerm.investAdvice,
      dipInvest: 'pause',
      positionAdjust: 'hold',
      recommendedFund: report.overall.midTerm.investAdvice?.recommendedFund ?? 'N/A',
    };
    report.overall.midTerm.riskWarning = `${na.headline}；原因：${gate.reasons.join('；')}`;
  }
}

function applyDualHoldOverlay(report: SnpAnalysisReport, dual: DualScoreVerdict): void {
  const ov = dual.actionOverride;
  if (!ov) return;
  if (report.overall?.shortTerm) {
    report.overall.shortTerm.action = ov.action;
    report.overall.shortTerm.riskWarning = ov.headline;
  }
  if (report.overall?.midTerm) {
    report.overall.midTerm.investAdvice = {
      ...report.overall.midTerm.investAdvice,
      dipInvest: 'continue',
      positionAdjust: 'hold',
      recommendedFund: report.overall.midTerm.investAdvice?.recommendedFund ?? 'N/A',
    };
    report.overall.midTerm.riskWarning = ov.headline;
  }
}

function printReport(report: SnpAnalysisReport, horizon: Horizon, extras: AnalysisExtras): void {
  const { overall, technical, fundamental, sentiment, etf: etfAnalysis, rebuttal, tailRisks } = report;

  console.log(header('🎯 SnpRush 综合分析报告', formatNow()));

  // 顶栏：门禁 / 双分 / 可信度 / 仓位
  if (extras.reliabilityCard) {
    console.log('\n' + formatReliabilityConsole(extras.reliabilityCard));
  }
  if (extras.dataQualityGate) {
    console.log('\n' + formatDataQualityGateConsole(extras.dataQualityGate));
  }
  if (extras.dualVerdict) {
    console.log('\n' + formatDualScoreConsole(extras.dualVerdict));
  }
  if (extras.positionRec) {
    console.log('\n' + formatPositionConsole(extras.positionRec));
  }
  if (extras.predictionTrack) {
    console.log('\n' + formatPredictionTrackConsole(extras.predictionTrack));
  }

  // 评分构成
  try {
    const bd = buildScoreBreakdown(technical, fundamental, sentiment, rebuttal);
    console.log('\n' + formatScoreBreakdownConsole(bd, '  '));
  } catch { /* ignore */ }

  if (extras.macroRegime) {
    console.log(`\n  🌐 宏观阶段: ${formatMacroRegimeLine(extras.macroRegime)}`);
  }

  if (extras.causalChains && extras.causalChains.length > 0) {
    console.log('\n' + formatCausalChainsConsole(extras.causalChains));
  }

  if (extras.judgeVerdict) {
    console.log('\n' + formatJudgeVerdictConsole(extras.judgeVerdict));
  }

  const similarText = buildSimilarPatternsConsole(report);
  if (similarText) console.log(similarText);

  if (extras.longTermOutlook) {
    console.log('\n' + formatLongTermOutlookConsole(extras.longTermOutlook));
  }

  const scoreDisplay = overall?.score ?? 'N/A';
  console.log(`\n  综合研判(LLM): ${directionMark(overall?.direction ?? 'neutral')} ${scoreDisplay}/100`);
  if (overall?.score != null) {
    console.log(`  ${scoreBar(overall.score)}`);
  }
  if (overall?.quantScore != null) {
    const delta = overall.score - overall.quantScore;
    const deltaStr = delta > 0 ? `LLM偏高 +${delta}` : delta < 0 ? `LLM偏低 ${delta}` : '一致';
    const quantDir = overall.quantScore >= 58 ? 'bullish' as const : overall.quantScore <= 42 ? 'bearish' as const : 'neutral' as const;
    console.log(`  🔢 量化评分: ${scoreBar(overall.quantScore)}`);
    console.log(`     量化=${overall.quantScore} ${directionMark(quantDir)} | LLM=${overall.score} | 偏差=${deltaStr} | 策略=${extras.dualVerdict?.actionPolicy ?? 'n/a'}`);
    if (overall.quantFactors) {
      console.log(formatQuantScoreConsole({
        score: overall.quantScore,
        direction: quantDir,
        factors: overall.quantFactors,
      }, '  '));
    }
  }

  const opAdvice = resolveOperationalAdvice({
    llmScore: overall?.score,
    direction: overall?.direction,
    dataActionable: extras.dataQualityGate?.actionable,
    dualActionOverride: extras.dualVerdict?.actionOverride ?? null,
    dualPolicy: extras.dualVerdict?.actionPolicy ?? null,
    position: extras.positionRec
      ? {
          headline: extras.positionRec.headline,
          action: extras.positionRec.action,
          emoji: extras.positionRec.emoji,
          label: extras.positionRec.label,
          tilt: extras.positionRec.tilt,
          targetPct: extras.positionRec.targetPct,
        }
      : null,
  });
  if (opAdvice) {
    console.log(`\n  💡 ${opAdvice.emoji} ${opAdvice.headline}: ${opAdvice.action}`);
  } else if (extras.advice) {
    console.log(`\n  💡 ${extras.advice.emoji} ${extras.advice.headline}: ${extras.advice.action}`);
  }

  if (extras.consistency) {
    console.log(`  📊  ${consistencyEmoji(extras.consistency.level)} 维度一致性: ${extras.consistency.summary}`);
  }

  if (overall?.calibration?.historicalAccuracy != null) {
    console.log(`  📊 校准: ${overall.calibration.scoreRange}区间 5日涨概率${Math.round(overall.calibration.historicalAccuracy * 100)}% (${overall.calibration.systematicBias})`);
  }

  console.log(`\n  ⚡ 情景分析`);
  const scenarios = overall?.scenarios;
  if (scenarios) {
    console.log(`  基准 (${scenarios.base.probability}%): ${scenarios.base.description} → ${scenarios.base.action}`);
    console.log(`  上行 (${scenarios.upside.probability}%): ${scenarios.upside.description} (触发: ${scenarios.upside.trigger})`);
    console.log(`  下行 (${scenarios.downside.probability}%): ${scenarios.downside.description} (触发: ${scenarios.downside.trigger})`);
  }

  console.log(`\n  📈 四维度摘要`);
  console.log(`  技术面: ${technical.score}/100 ${directionMark(technical.direction)} — ${technical.summary}`);
  console.log(`  基本面: ${fundamental.score}/100 ${directionMark(fundamental.direction)} — ${fundamental.summary}`);
  console.log(`  情绪面: ${sentiment.score}/100 ${directionMark(sentiment.direction)} — ${sentiment.summary}`);
  console.log(`  ETF面: 估值${etfAnalysis.valuation.level} | 轮动: ${etfAnalysis.sectorRotation.rotationSignal}`);

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

  const tailRiskList = tailRisks ?? [];
  if (tailRiskList.length > 0) {
    console.log(`\n  ⚠️ 尾部风险`);
    for (const risk of tailRiskList) {
      console.log(`  ${risk.probability}% → ${risk.risk}: ${risk.impact} (触发: ${risk.trigger})`);
      console.log(`    对冲: ${risk.mitigation}`);
    }
    const maxCap = getConfig().investment.maxTailRiskIndex * 2.5;
    const { index, rawUnion } = computeTailRiskIndex(tailRiskList, maxCap);
    console.log(`  综合尾部风险指数: ${index.toFixed(1)}%`);
    if (rawUnion - index > 5) {
      console.log(`  （朴素并概率 ${rawUnion.toFixed(1)}%，已做互斥修正）`);
    }
  }

  console.log(separator('═', 55));
}

/** 历史相似日 — 从 scenario_features 找最近相似日 */
function buildSimilarPatternsConsole(report: SnpAnalysisReport): string {
  try {
    const db = getDb();
    const repo = new ScenarioFeaturesRepo(db);
    const features = repo.getRecent(200);
    if (features.length < 5) return '';
    const currentVix = report.marketData?.vix?.value?.value ?? 20;
    const currentDxy = (report.marketData?.dollarIndex?.value?.change ?? 0) > 0.3 ? 'up' : (report.marketData?.dollarIndex?.value?.change ?? 0) < -0.3 ? 'down' : 'flat';
    const scored = features
      .map(f => ({
        date: f.date,
        vixDiff: Math.abs((f.vixLevel ?? 20) - currentVix),
        dollarMatch: f.dollarDirection === currentDxy ? 0 : 1,
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
