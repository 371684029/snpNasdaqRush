// snprush analysis — 综合分析报告（数据门禁 + 双打分 + 可信度 + 仓位）

import { DataCollectorAgent } from '../agents/data-collector.js';
import { ValidatorAgent } from '../agents/validator.js';
import { TechnicalAgent, FundamentalAgent, SentimentAgent, EtfFundAgent } from '../agents/analysis-agents.js';
import { RebuttalAgent } from '../agents/rebuttal.js';
import { OrchestratorAgent } from '../agents/orchestrator.js';
import { header, separator, directionMark, scoreBar, valuationMark } from '../utils/format.js';
import { formatNow, todayDate } from '../utils/time.js';
import { getDb } from '../db/index.js';
import { IndexPricesRepo } from '../db/index-prices.js';
import { ReportsRepo } from '../db/reports.js';
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
  checkConsistency,
  consistencyEmoji,
  resolveOperationalAdvice,
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
import type { Horizon } from '../types/config.js';
import type { SnpAnalysisReport } from '../types/analysis.js';

export interface AnalysisExtras {
  dataQualityGate?: DataQualityGate;
  dualVerdict?: DualScoreVerdict;
  positionRec?: PositionRecommendation;
  predictionTrack?: PredictionTrackStats;
  reliabilityCard?: ReliabilityCard;
  consistency?: ConsistencyCheck;
}

export async function analysisCommand(options: {
  horizon: Horizon;
  json: boolean;
  save: boolean;
  md: boolean;
}): Promise<number> {
  console.log('\n🔬 SnpRush 综合分析启动...\n');

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

  // Step 1: 采集 + 验证
  console.log('  📡 Step 1: 采集市场数据...');
  const collector = new DataCollectorAgent();
  let marketData;
  try {
    marketData = await collector.collectMarketData();
  } catch (err) {
    console.error('数据采集失败:', err instanceof Error ? err.message : err);
    await collector.cleanup();
    return 1;
  }

  const validator = new ValidatorAgent();
  const validation = await validator.validate(marketData);
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

  // Step 2: 四维度（串行，避免 LLM 并发争抢）
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

  // Step 3: 综合编排（强制综合分 = 反驳修正分）
  console.log('  🎯 Step 3: 综合编排...');
  const orchestrator = new OrchestratorAgent();
  const report = await orchestrator.orchestrate(
    marketData,
    technical,
    fundamental,
    sentiment,
    etf,
    rebuttal,
    options.horizon,
    quant.score,
    quant.factors,
  );
  report.dataQuality = {
    overallConfidence: validation.overallConfidence,
    warnings: [
      ...(validation.warnings ?? []),
      ...dataQualityGate.banners.map(b => b.trim()),
    ],
  };
  report.overall.quantScore = quant.score;
  report.overall.quantFactors = quant.factors;
  console.log('  ✅ 编排完成');

  // 一致性 / 双打分 / 仓位 / 可信度 / 预测对错
  const consistency = checkConsistency([
    { name: '技术面', score: technical.score },
    { name: '基本面', score: fundamental.score },
    { name: '情绪面', score: sentiment.score },
  ]);
  const dualVerdict = evaluateDualScore(report.overall.score, quant.score, {
    consistencyWeak: consistency.level === 'weak',
    dataActionable: dataQualityGate.actionable,
  });
  if (!dataQualityGate.actionable) {
    applyNonActionableOverlay(report, dataQualityGate);
  } else if (dualVerdict.actionOverride) {
    applyDualHoldOverlay(report, dualVerdict);
  }
  console.log(formatDualScoreConsole(dualVerdict));

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
  console.log(formatPositionConsole(positionRec));

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
  console.log(formatReliabilityConsole(reliabilityCard));

  const extras: AnalysisExtras = {
    dataQualityGate,
    dualVerdict,
    positionRec,
    predictionTrack,
    reliabilityCard,
    consistency,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report, options.horizon, extras);
  }

  if (options.md) {
    const fs = await import('node:fs');
    const docsDir = 'docs';
    if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
    const filename = `${docsDir}/snprush-analysis-${new Date().toISOString().slice(0, 10)}.md`;
    fs.writeFileSync(filename, formatReportMarkdown(report, options.horizon, extras), 'utf-8');
    console.log(`\n📝 报告已保存为 Markdown: ${filename}`);
  }

  if (options.save) {
    const filename = `snprush-analysis-${new Date().toISOString().slice(0, 10)}.json`;
    const fs = await import('node:fs');
    fs.writeFileSync(filename, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`\n💾 报告已保存到 ${filename}`);
  }

  await collector.cleanup();
  await validator.cleanup();
  await rebuttalAgent.cleanup();
  await orchestrator.cleanup();
  return 0;
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

function printReport(report: SnpAnalysisReport, horizon: Horizon, extras?: AnalysisExtras): void {
  const { overall, technical, fundamental, sentiment, etf: etfAnalysis, rebuttal } = report;
  const tailRisks = report.tailRisks ?? rebuttal?.tailRisks ?? [];

  console.log(header('🎯 SnpRush 综合分析报告', formatNow()));

  if (extras?.reliabilityCard) {
    console.log('\n' + formatReliabilityConsole(extras.reliabilityCard));
  }
  if (extras?.dataQualityGate) {
    console.log('\n' + formatDataQualityGateConsole(extras.dataQualityGate));
  }
  if (extras?.dualVerdict) {
    console.log('\n' + formatDualScoreConsole(extras.dualVerdict));
  }
  if (extras?.positionRec) {
    console.log('\n' + formatPositionConsole(extras.positionRec));
  }
  if (extras?.predictionTrack) {
    console.log('\n' + formatPredictionTrackConsole(extras.predictionTrack));
  }

  const scoreDisplay = overall?.score ?? 'N/A';
  const directionDisplay = overall?.direction ?? 'neutral';
  const gate = extras?.dataQualityGate;
  const dual = extras?.dualVerdict;
  const advice = resolveOperationalAdvice({
    llmScore: overall?.score,
    direction: overall?.direction,
    dataActionable: gate?.actionable,
    dualActionOverride: dual?.actionOverride ?? null,
    dualPolicy: dual?.actionPolicy ?? null,
    position: extras?.positionRec
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

  console.log(`\n  综合研判(LLM): ${directionMark(directionDisplay)} ${scoreDisplay}/100`);
  if (overall?.score != null) {
    console.log(`  ${scoreBar(overall.score)}`);
  }
  if (overall?.quantScore != null) {
    const delta = overall.score - overall.quantScore;
    const deltaStr = delta > 0 ? `LLM偏高 +${delta}` : delta < 0 ? `LLM偏低 ${delta}` : '一致';
    const quantDir = overall.quantScore >= 58 ? 'bullish' : overall.quantScore <= 42 ? 'bearish' : 'neutral';
    console.log(`  🔢 量化评分: ${scoreBar(overall.quantScore)}`);
    console.log(`     量化=${overall.quantScore} ${directionMark(quantDir)} | LLM=${overall.score} | 偏差=${deltaStr} | 策略=${dual?.actionPolicy ?? 'n/a'}`);
    if (overall.quantFactors) {
      console.log(formatQuantScoreConsole({
        score: overall.quantScore,
        direction: quantDir,
        factors: overall.quantFactors,
      }, '  '));
    }
  }
  if (advice) {
    console.log(`  💡 ${advice.emoji} ${advice.action}`);
    console.log(`     [${advice.source}] ${advice.headline}`);
  }

  const consistency = extras?.consistency ?? checkConsistency([
    { name: '技术面', score: technical.score },
    { name: '基本面', score: fundamental.score },
    { name: '情绪面', score: sentiment.score },
  ]);
  console.log(`  📊  ${consistencyEmoji(consistency.level)} 维度一致性: ${consistency.summary}`);

  if (overall?.calibration?.historicalAccuracy != null) {
    console.log(`  📊 校准参考: ${overall.calibration.scoreRange}区间历史准确率${Math.round(overall.calibration.historicalAccuracy * 100)}% (${overall.calibration.systematicBias})`);
  } else if (overall?.score != null) {
    console.log('  📊 校准: 样本积累中（需≥5次），评分仅供参考');
  }

  console.log(`\n  ⚡ 情景分析`);
  const scenarios = overall?.scenarios;
  if (scenarios) {
    console.log(`  基准 (${scenarios.base.probability}%): ${scenarios.base.description} → ${scenarios.base.action}`);
    console.log(`  上行 (${scenarios.upside.probability}%): ${scenarios.upside.description} (触发: ${scenarios.upside.trigger})`);
    console.log(`  下行 (${scenarios.downside.probability}%): ${scenarios.downside.description} (触发: ${scenarios.downside.trigger})`);
  } else {
    console.log('  (情景数据暂不可用)');
  }

  console.log(`\n  📈 四维度摘要`);
  console.log(`  技术面: ${technical.score}/100 ${directionMark(technical.direction)} — ${technical.summary}`);
  console.log(`  基本面: ${fundamental.score}/100 ${directionMark(fundamental.direction)} — ${fundamental.summary}`);
  console.log(`  情绪面: ${sentiment.score}/100 ${directionMark(sentiment.direction)} — ${sentiment.summary}`);
  console.log(`  ETF/板块: ${valuationMark(etfAnalysis.valuation.level)} | 轮动: ${etfAnalysis.sectorRotation.rotationSignal}`);

  console.log(`\n  🔴 强制反驳摘要`);
  console.log(`  反驳强度: ${rebuttal.rebuttalStrength} | 看空力度: ${rebuttal.bearScore}/100`);
  for (const point of (rebuttal.bearPoints ?? []).slice(0, 3)) {
    console.log(`  · ${point.point} (${point.probability}%概率)`);
  }
  for (const vul of (rebuttal.bullVulnerabilities ?? []).slice(0, 2)) {
    console.log(`  · 看多漏洞: ${vul.vulnerability}`);
  }
  if (rebuttal.adjustedScore) {
    console.log(`  → 评分从初步${Math.round((technical.score + fundamental.score + sentiment.score) / 3)}分调整为${rebuttal.adjustedScore}分`);
  }

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

  if (tailRisks.length > 0) {
    console.log(`\n  ⚠️ 尾部风险`);
    for (const risk of tailRisks) {
      console.log(`  ${risk.probability}% → ${risk.risk}: ${risk.impact} (触发: ${risk.trigger})`);
      console.log(`    对冲: ${risk.mitigation}`);
    }
    const maxCap = getConfig().investment.maxTailRiskIndex * 2.5;
    const { index, rawUnion } = computeTailRiskIndex(tailRisks, maxCap);
    console.log(`  综合尾部风险指数: ${index.toFixed(1)}%`);
    if (rawUnion - index > 5) {
      console.log(`  （朴素并概率 ${rawUnion.toFixed(1)}%，已做互斥修正）`);
    }
  }

  console.log(separator('═', 55));
}
