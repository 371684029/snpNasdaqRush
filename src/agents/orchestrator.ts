// 综合编排 Agent — 汇总四维度 + 反驳 + 校准 + 双轨策略

import { BaseAgent } from './base.js';
import { getConfig } from '../utils/config.js';
import { getDb } from '../db/index.js';
import { CalibrationRepo } from '../db/calibration.js';
import { ScenarioFeaturesRepo } from '../db/scenario-features.js';
import { ReportsRepo } from '../db/reports.js';
import type { TechnicalAnalysis, FundamentalAnalysis, SentimentAnalysis, Direction, ShortTermStrategy, MidTermStrategy, Scenarios, RebuttalAnalysis, SnpAnalysisReport } from '../types/analysis.js';
import type { MarketData } from '../types/market.js';
import type { EtfAnalysis } from '../types/etf.js';
import { resolveOverallScore, enforceOverallScore } from '../utils/overall-score.js';
import { applyCalibrationBias, momentumAdjustScenarios } from '../utils/calibration-adjustment.js';
import { IndexPricesRepo } from '../db/index-prices.js';
import { computeHistoricalScenarioProbs } from '../utils/scenario-probability.js';
import { countConsecutiveDirectionDays } from '../utils/consecutive-direction.js';

export interface OrchestrateContext {
  causalChainsText?: string;
  reportsContext?: string;
  macroRegimeLine?: string;
}

const ORCHESTRATOR_PROMPT = `你是美股投资研究综合编排师。你将汇总技术面、基本面、情绪面、ETF/板块面四维度分析，结合反驳分析和校准数据，输出双视角策略报告。

## 双视角分析规则

### 短期视角（日线级别，持仓数天~2周）
- 操作品种：SPY、QQQ 场内ETF
- 入场信号：日线MACD金叉、RSI超卖回升等
- 出场策略：目标位止盈 + 固定止损(3-5%)
- 快进快出，不恋战

### 中长期视角（周线级别，持仓1~6个月）
- 第一层：核心持仓（60-70%）— SPY/VOO 定投
- 第二层：卫星配置（30-40%）— QQQ 等成长暴露
- 风控：估值止盈、仓位管理

## 情景分析要求
你必须输出三个情景（基准/上行/下行），而非单一预测：
1. 基准情景：最可能发生的路径（概率45-60%）
2. 上行情景：超预期情景（概率15-30%）
3. 下行情景：不及预期情景（概率15-30%，不得低于15%）

规则：
- 三个概率之和 = 100%
- 每个情景必须有明确的触发条件
- 下行情景的概率不得低于15%

## 反驳结果处理
1. 如果反驳强度≥中等，在风险提示中突出看空论据
2. 不得忽略反驳结果
3. 评分应考虑反驳修正

## 输出格式（严格遵守，直接输出JSON，不要用markdown代码块）
{
  "overall": {
    "score": 数字(0-100),
    "direction": "bullish/bearish/neutral",
    "scenarios": {
      "base": { "probability": 数字, "description": "字符串", "indexPrice": "SPX目标", "nasdaqPrice": "IXIC目标", "action": "字符串", "confidence": "low/moderate/high" },
      "upside": { "probability": 数字, "description": "字符串", "indexPrice": "SPX目标", "nasdaqPrice": "IXIC目标", "trigger": "字符串", "action": "字符串", "confidence": "low/moderate/high" },
      "downside": { "probability": 数字, "description": "字符串", "indexPrice": "SPX目标", "nasdaqPrice": "IXIC目标", "trigger": "字符串", "action": "字符串", "confidence": "low/moderate/high" }
    },
    "shortTerm": {
      "horizon": "short-term",
      "action": "字符串",
      "spxEntryZone": "SPX入场区间",
      "ixicEntryZone": "IXIC入场区间",
      "target": "目标位",
      "stopLoss": "止损位",
      "recommendedProduct": "推荐品种",
      "riskWarning": "风险提示"
    },
    "midTerm": {
      "horizon": "medium-term",
      "investAdvice": { "dipInvest": "continue/increase/pause", "positionAdjust": "add/reduce/hold", "recommendedFund": "推荐配置" },
      "keyLevels": { "spxSupportZone": "SPX支撑区", "spxResistanceZone": "SPX阻力区", "ixicSupportZone": "IXIC支撑区", "ixicResistanceZone": "IXIC阻力区" },
      "assetAllocation": "股债配置建议",
      "riskWarning": "风险提示"
    }
  }
}`;

export class OrchestratorAgent extends BaseAgent {
  constructor() {
    const config = getConfig();
    super({ name: 'orchestrator', model: config.models.orchestrator, systemPrompt: ORCHESTRATOR_PROMPT });
  }

  async orchestrate(
    marketData: MarketData,
    technical: TechnicalAnalysis,
    fundamental: FundamentalAnalysis,
    sentiment: SentimentAnalysis,
    etf: EtfAnalysis,
    rebuttal: RebuttalAnalysis,
    horizon: 'short' | 'mid' | 'all' = 'all',
    ctx?: OrchestrateContext,
  ): Promise<SnpAnalysisReport> {
    const db = getDb();
    const calibrationRepo = new CalibrationRepo(db);
    const initialScore = rebuttal.adjustedScore ?? Math.round((technical.score + fundamental.score + sentiment.score) / 3);
    const calibrationContext = calibrationRepo.getCalibrationContext(initialScore);

    try {
      calibrationRepo.backfillPending();
    } catch { /* ignore */ }

    let calibrationText = '校准数据不足（样本<5），暂无统计参考';
    if (calibrationContext && calibrationContext.historicalAccuracy !== null) {
      calibrationText = `评分${calibrationContext.scoreRange}区间：历史${calibrationContext.sampleSize}次分析，实际涨概率${Math.round(calibrationContext.historicalAccuracy * 100)}%，系统偏差：${calibrationContext.systematicBias}`;
    }

    const schema = {
      type: 'object',
      properties: {
        overall: {
          type: 'object',
          properties: {
            score: { type: 'number' },
            direction: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] },
            scenarios: {
              type: 'object',
              properties: {
                base: { type: 'object', properties: { probability: { type: 'number' }, description: { type: 'string' }, indexPrice: { type: 'string' }, nasdaqPrice: { type: 'string' }, action: { type: 'string' }, confidence: { type: 'string' } } },
                upside: { type: 'object', properties: { probability: { type: 'number' }, description: { type: 'string' }, indexPrice: { type: 'string' }, nasdaqPrice: { type: 'string' }, trigger: { type: 'string' }, action: { type: 'string' }, confidence: { type: 'string' } } },
                downside: { type: 'object', properties: { probability: { type: 'number' }, description: { type: 'string' }, indexPrice: { type: 'string' }, nasdaqPrice: { type: 'string' }, trigger: { type: 'string' }, action: { type: 'string' }, confidence: { type: 'string' } } },
              },
            },
            shortTerm: {
              type: 'object',
              properties: {
                horizon: { type: 'string' }, action: { type: 'string' },
                spxEntryZone: { type: 'string' }, ixicEntryZone: { type: 'string' },
                target: { type: 'string' }, stopLoss: { type: 'string' },
                recommendedProduct: { type: 'string' }, riskWarning: { type: 'string' },
              },
            },
            midTerm: {
              type: 'object',
              properties: {
                horizon: { type: 'string' },
                investAdvice: { type: 'object', properties: { dipInvest: { type: 'string' }, positionAdjust: { type: 'string' }, recommendedFund: { type: 'string' } } },
                keyLevels: { type: 'object', properties: { spxSupportZone: { type: 'string' }, spxResistanceZone: { type: 'string' }, ixicSupportZone: { type: 'string' }, ixicResistanceZone: { type: 'string' } } },
                assetAllocation: { type: 'string' },
                riskWarning: { type: 'string' },
              },
            },
          },
        },
      },
      required: ['overall'],
    };

    const fmtPct = (v: number | null | undefined): string => (v == null ? 'N/A' : `${v > 0 ? '+' : ''}${v}%`);

    const prompt = `## 市场数据
SPX: ${marketData.spx?.price?.value ?? 'N/A'} (${fmtPct(marketData.spx?.price?.change)})
IXIC: ${marketData.ixic?.price?.value ?? 'N/A'} (${fmtPct(marketData.ixic?.price?.change)})
VIX: ${marketData.vix?.value?.value ?? 'N/A'}
美元指数: ${marketData.dollarIndex?.value?.value ?? 'N/A'}
10Y美债: ${marketData.usTreasury?.yield10y?.value ?? 'N/A'}%
2Y美债: ${marketData.usTreasury?.yield2y?.value ?? 'N/A'}%

## 技术面 (${technical.score}/100 ${technical.direction})
SPX短期: ${technical.spx.shortTerm.trend}, ${technical.spx.shortTerm.keySignal}
SPX中长期: ${technical.spx.midTerm.trend}, ${technical.spx.midTerm.keySignal}
IXIC短期: ${technical.ixic.shortTerm.trend}, ${technical.ixic.shortTerm.keySignal}
IXIC中长期: ${technical.ixic.midTerm.trend}, ${technical.ixic.midTerm.keySignal}
相对强弱: ${technical.relativeStrength}
板块轮动: ${technical.sectorRotation}

## 基本面 (${fundamental.score}/100 ${fundamental.direction})
${fundamental.keyPoints.join('; ')}

## 情绪面 (${sentiment.score}/100 ${sentiment.direction})
${sentiment.keyPoints.join('; ')}

## ETF/板块面
估值: ${etf.valuation.level}, 板块领涨: ${etf.sectorRotation.leading.join(', ')}

## 反驳分析
看空力度: ${rebuttal.bearScore}/100 (强度: ${rebuttal.rebuttalStrength})
看空论据: ${(rebuttal.bearPoints ?? []).map(p => p.point).join('; ')}
评分修正: ${rebuttal.adjustedScore ?? '未修正'} (${rebuttal.netEffect})

## 历史校准
${calibrationText}

${ctx?.macroRegimeLine ? `## 宏观阶段\n${ctx.macroRegimeLine}\n` : ''}\
${ctx?.causalChainsText ? `## 因果链参考\n${ctx.causalChainsText}\n` : ''}\
${ctx?.reportsContext ? `## 近期分析趋势\n${ctx.reportsContext}\n` : ''}\
## 评分规则
1. 你的自评分仅作参考，会被公式覆盖，无需过度纠结自评分的精确值
2. 重点放在情景分析质量和操作建议的具体性上
3. 三情景概率之和必须精确等于100%
4. 如果反驳强度≥moderate，必须在风险提示中体现看空论据

## 输出视角
${horizon === 'short' ? '仅短期视角' : horizon === 'mid' ? '仅中长期视角' : '双视角（短期+中长期）'}

请输出综合研判报告，包含情景分析和双轨策略。`;

    const result = await this.structuredPrompt<{
      overall: {
        score: number;
        direction: Direction;
        scenarios: Scenarios;
        shortTerm: ShortTermStrategy;
        midTerm: MidTermStrategy;
      };
    }>(prompt, schema);

    // 评分一致性：以反驳修正分 + resolveOverallScore 为准，覆盖 LLM 自评分
    const finalScore = resolveOverallScore(
      { adjustedScore: rebuttal.adjustedScore },
      { technical: technical.score, fundamental: fundamental.score, sentiment: sentiment.score },
    );
    const enforcedScore = enforceOverallScore(result.overall?.score, finalScore);

    // 校准偏纠偏：如果系统有统计偏（偏保守/偏乐观），纯函数强制修正
    const calibrationBias = calibrationContext?.systematicBias ?? null;
    const calibrateSampleSize = calibrationContext?.sampleSize ?? 0;
    const biasCorrectedScore = applyCalibrationBias(enforcedScore, calibrationBias, calibrateSampleSize);

    // 动量校准情景概率：从 DB 取近 10 日收盘价算 SPX 涨幅
    let spxMomentumPct: number | null = null;
    let priceRepo: IndexPricesRepo | null = null;
    try {
      priceRepo = new IndexPricesRepo(db);
      const recent = priceRepo.getRecent(10);
      if (recent.length >= 2) {
        const firstClose = recent.find(r => r.spxClose != null);
        const lastClose = recent[recent.length - 1];
        if (firstClose?.spxClose && lastClose?.spxClose && firstClose.date !== lastClose.date) {
          spxMomentumPct = ((lastClose.spxClose - firstClose.spxClose) / firstClose.spxClose) * 100;
        }
      }
    } catch { /* 动量计算失败不阻断 */ }

    const scenarios = result.overall?.scenarios;
    let adjustedScenarios = scenarios;
    if (scenarios) {
      const { upside, base, downside } = momentumAdjustScenarios(
        scenarios.upside?.probability ?? 25,
        scenarios.downside?.probability ?? 20,
        spxMomentumPct,
      );
      adjustedScenarios = {
        base: { ...scenarios.base, probability: base },
        upside: { ...scenarios.upside, probability: upside },
        downside: { ...scenarios.downside, probability: downside },
      };

      // 历史分布概率覆盖 — 对齐 goldRush 的统计化情景概率
      try {
        const historyPrices = priceRepo?.getRecent(120);
        if (historyPrices && historyPrices.length > 5) {
          const histProbs = computeHistoricalScenarioProbs(historyPrices);
          if (histProbs.source === 'historical') {
            adjustedScenarios = {
              base: { ...scenarios.base, probability: histProbs.base },
              upside: { ...scenarios.upside, probability: histProbs.upside },
              downside: { ...scenarios.downside, probability: histProbs.downside },
            };
          }
        }
      } catch { /* 历史分布计算失败不阻断 */ }
    }

    const report: SnpAnalysisReport = {
      timestamp: new Date().toISOString(),
      marketData,
      dataQuality: {
        overallConfidence: 80,
        warnings: [],
      },
      technical,
      fundamental,
      sentiment,
      etf,
      rebuttal,
      tailRisks: rebuttal.tailRisks ?? [],
      overall: {
        ...result.overall,
        score: biasCorrectedScore,
        scenarios: adjustedScenarios,
        calibration: calibrationContext ?? {
          scoreRange: 'N/A',
          historicalAccuracy: null,
          systematicBias: '样本不足',
          sampleSize: 0,
        },
      },
    };

    this.saveReport(report, horizon);

    return report;
  }

  private saveReport(report: SnpAnalysisReport, horizon: string): void {
    try {
      const db = getDb();
      const reportsRepo = new ReportsRepo(db);
      const reportId = reportsRepo.insert({
        date: report.timestamp.slice(0, 10),
        horizon,
        reportJson: JSON.stringify(report),
        overallScore: report.overall.score,
        direction: report.overall.direction,
      });

      const featuresRepo = new ScenarioFeaturesRepo(db);
      const d = report.marketData?.dollarIndex?.value?.change ?? 0;
      featuresRepo.insert({
        date: report.timestamp.slice(0, 10),
        reportId,
        dollarDirection: d > 0.5 ? 'up' : d < -0.5 ? 'down' : 'flat',
        dollarMagnitude: Math.abs(d),
        tipsDirection: 'flat',
        tipsMagnitude: 0,
        vixLevel: report.marketData?.vix?.value?.value ?? 0,
        fedStance: 'neutral',
        momentumDirection: report.overall.direction === 'bullish' ? 'up' : report.overall.direction === 'bearish' ? 'down' : 'flat',
        consecutiveDays: countConsecutiveDirectionDays(report.overall.direction),
      });
    } catch (err) {
      console.error('保存报告失败:', err);
    }
  }
}
