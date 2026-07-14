// 信息验证 Agent — 多源交叉验证 + Tavily spot-check + Yahoo 锚定 + LLM 异常检测
// 对齐 goldRush validator.ts（7 阶段流水线）

import { BaseAgent } from './base.js';
import { getConfig } from '../utils/config.js';
import { SearchRouter } from '../data/search-router.js';
import { fetchSpxLive, fetchDxyLive } from '../data/yahoo-live.js';
import { checkIndexPriceConsistency } from '../utils/price-consistency.js';
import { crossValidate, checkFreshness, validationSourcesFromPrices } from '../utils/source-rank.js';
import { extractSpxPricesFromSearch, mergeValidationSources, needsSpotCheck } from '../utils/spot-verify.js';
import type { MarketData, ValidationResult } from '../types/market.js';

const VALIDATION_SYSTEM_PROMPT = `你是美股市场数据验证专家。你的任务是验证采集到的市场数据的准确性和时效性。

## 验证规则
1. **3源验证**：同一数据点至少3个独立来源交叉验证
   - 3源一致 → ✅ 采信
   - 2源一致，1源偏差<0.5% → ⚠️ 取均值
   - 3源差异>1% → ❌ 标注可疑

2. **来源分级**：
   - A级（权威）：交易所、美联储 → 直接采信
   - B级（可信）：财经媒体 → 采信但需验证
   - C级（参考）：自媒体 → 仅参考

3. **时效性**：价格数据 > 4小时 → 标注⚠️；利率 > 1天 → 正常

4. **内在一致性**：SPX与SPY之间存在近似SPX÷10的跟踪关系、VIX与SPX负相关、美元强弱与美股表现关系`;

const VALIDATION_SCHEMA = {
  type: 'object',
  properties: {
    anomalies: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, issue: { type: 'string' }, severity: { type: 'string', enum: ['low', 'medium', 'high'] } }, required: ['field', 'issue', 'severity'] } },
    crossValidationNotes: { type: 'string' },
    overallAssessment: { type: 'string', enum: ['normal', 'suspicious', 'unreliable'] },
    llmConfidence: { type: 'number' },
  },
  required: ['anomalies', 'overallAssessment', 'llmConfidence'],
};

export class ValidatorAgent extends BaseAgent {
  private searchRouter: SearchRouter;

  constructor() {
    const config = getConfig();
    super({ name: 'validator', model: config.models.validator, systemPrompt: VALIDATION_SYSTEM_PROMPT });
    this.searchRouter = new SearchRouter(config.search.tavilyApiKey);
  }

  async validate(data: MarketData): Promise<{ validations: ValidationResult[]; overallConfidence: number; warnings: string[] }> {
    // === 阶段 1: 预取 Yahoo 实时数据作为 A 级锚定源 ===
    const [yahooSpx, yahooDxy] = await Promise.all([
      fetchSpxLive().catch(() => null),
      fetchDxyLive().catch(() => null),
    ]);

    const validations: ValidationResult[] = [];

    // === 阶段 2: 逐字段交叉验证 + 源注入 ===
    if (data.spx?.price?.value != null) {
      let sources = validationSourcesFromPrices(data.spx.price, data.spx.altPrices);
      if (yahooSpx) {
        sources.unshift({ value: yahooSpx.price, source: 'Yahoo Finance ^GSPC', grade: 'A', timestamp: yahooSpx.timestamp });
      }
      if (needsSpotCheck(sources)) {
        try {
          const results = await this.searchRouter.searchBatch([
            { query: 'S&P 500 index level today SPX', dataType: 'spx' },
            { query: 'S&P 500 futures price live', dataType: 'spx' },
          ], { numResults: 4 });
          const flat = [...results.values()].flat();
          sources = mergeValidationSources(sources, extractSpxPricesFromSearch(flat));
        } catch { /* spot-check 失败不阻断 */ }
      }
      validations.push(crossValidate('spx.price', sources));
    }

    if (data.ixic?.price?.value != null) {
      let sources = validationSourcesFromPrices(data.ixic.price, data.ixic.altPrices);
      validations.push(crossValidate('ixic.price', sources));
    }

    if (data.spy?.nav?.value != null) {
      validations.push(crossValidate('spy.nav', [{
        value: data.spy.nav.value, source: data.spy.nav.source ?? 'unknown',
        grade: data.spy.nav.sourceGrade ?? 'C', timestamp: data.spy.nav.verifiedAt ?? '',
      }]));
    }

    if (data.vix?.value?.value != null) {
      const sources = [{
        value: data.vix.value.value, source: data.vix.value.source ?? 'unknown',
        grade: data.vix.value.sourceGrade ?? 'C', timestamp: data.vix.value.verifiedAt ?? '',
      }];
      validations.push(crossValidate('vix.value', sources));
    }

    if (data.dollarIndex?.value?.value != null) {
      const sources = [{
        value: data.dollarIndex.value.value, source: data.dollarIndex.value.source ?? 'unknown',
        grade: data.dollarIndex.value.sourceGrade ?? 'C', timestamp: data.dollarIndex.value.verifiedAt ?? '',
      }];
      if (yahooDxy) {
        sources.unshift({ value: yahooDxy.price, source: 'Yahoo Finance DX-Y.NYB', grade: 'A', timestamp: yahooDxy.timestamp });
      }
      validations.push(crossValidate('dollarIndex.value', sources));
    }

    // === 阶段 3: 警告生成 ===
    const warnings: string[] = [];
    for (const v of validations) {
      if (v.consensus === 'major_conflict') {
        warnings.push(`🔴 ${v.field} 多源冲突（置信度 ${v.confidence}%）`);
      } else if (v.consensus === 'single_source') {
        warnings.push(`🟡 ${v.field} 仅单源（置信度 ${v.confidence}%）`);
      } else if (v.sources.length >= 2 && v.consensus === 'verified') {
        warnings.push(`✅ ${v.field} ${v.sources.length}源一致（置信度 ${v.confidence}%）`);
      }
    }

    // === 阶段 4: 新鲜度检查 ===
    const freshness = checkFreshness(data.timestamp);
    if (!freshness.fresh && freshness.warning) warnings.push(freshness.warning);

    // === 阶段 5: 价格内部一致性校验 ===
    const spxVal = data.spx?.price?.value;
    const spyVal = data.spy?.nav?.value;
    const consistency = spxVal != null
      ? checkIndexPriceConsistency(spxVal, spyVal ?? null, yahooSpx?.price ?? null)
      : null;
    if (consistency) warnings.push(...consistency.warnings);

    // === 阶段 6: LLM 深度验证（可选） ===
    const dataSummary = [
      `时间戳: ${data.timestamp}`,
      `SPX: ${data.spx?.price?.value ?? 'N/A'} (${data.spx?.price?.change ?? 'N/A'}%) 来源: ${data.spx?.price?.source ?? 'N/A'}`,
      `IXIC: ${data.ixic?.price?.value ?? 'N/A'} (${data.ixic?.price?.change ?? 'N/A'}%) 来源: ${data.ixic?.price?.source ?? 'N/A'}`,
      `SPY: ${data.spy?.nav?.value ?? 'N/A'} | QQQ: ${data.qqq?.nav?.value ?? 'N/A'}`,
      `VIX: ${data.vix?.value?.value ?? 'N/A'} | 美元: ${data.dollarIndex?.value?.value ?? 'N/A'}`,
      `10Y: ${data.usTreasury?.yield10y?.value ?? 'N/A'}% | 2Y: ${data.usTreasury?.yield2y?.value ?? 'N/A'}%`,
    ].join('\n');

    let llmAssessment: {
      anomalies: Array<{ field: string; issue: string; severity: string }>;
      overallAssessment: string; llmConfidence: number;
    } | null = null;

    try {
      llmAssessment = await this.structuredPrompt<{
        anomalies: Array<{ field: string; issue: string; severity: string }>;
        overallAssessment: 'normal' | 'suspicious' | 'unreliable';
        llmConfidence: number;
      }>(
        `请验证以下美股市场数据的准确性和内在一致性，尤其关注：\n`
        + `1. SPX与SPY的跟踪关系是否合理（SPY ≈ SPX ÷ 10）\n`
        + `2. VIX与SPX的走势关系是否符合反向规律\n`
        + `3. 各项数据是否有明显异常或背离\n\n` + dataSummary,
        VALIDATION_SCHEMA,
      );
    } catch (err) {
      console.error('  ⚠️ LLM验证不可用，降级为纯本地验证:', err instanceof Error ? err.message : 'unknown');
    }

    if (llmAssessment) {
      for (const anomaly of llmAssessment.anomalies ?? []) {
        if (anomaly.severity === 'high') warnings.push(`🔴 ${anomaly.field}: ${anomaly.issue}`);
        else if (anomaly.severity === 'medium') warnings.push(`🟡 ${anomaly.field}: ${anomaly.issue}`);
      }
      if (llmAssessment.overallAssessment === 'unreliable') {
        warnings.push('🔴 LLM 评估：数据整体不可靠，请人工核实');
      } else if (llmAssessment.overallAssessment === 'suspicious') {
        warnings.push('🟡 LLM 评估：数据存在部分异常');
      }
    }

    // === 阶段 7: 混合置信度（60% 本地 + 40% LLM） ===
    const baseLocalConfidence = validations.length > 0
      ? Math.round(validations.reduce((sum, v) => sum + v.confidence, 0) / validations.length)
      : 50;
    const consistencyBonus = consistency?.bonusConfidence ?? 0;
    const localConfidence = Math.max(10, Math.min(95, baseLocalConfidence + consistencyBonus));

    let overallConfidence: number;
    if (llmAssessment) {
      const llmConf = typeof llmAssessment.llmConfidence === 'number' && !Number.isNaN(llmAssessment.llmConfidence)
        ? llmAssessment.llmConfidence : 50;
      overallConfidence = Math.round(localConfidence * 0.6 + llmConf * 0.4);
    } else {
      overallConfidence = localConfidence;
    }

    return { validations, overallConfidence, warnings };
  }
}
