// 数据采集 Agent — 双引擎搜索 + 结构化提取 SPX/IXIC 数据

import { BaseAgent } from './base.js';
import { getConfig } from '../utils/config.js';
import { getDb } from '../db/index.js';
import { IndexPricesRepo } from '../db/index-prices.js';
import { SearchRouter } from '../data/search-router.js';
import { todayDate, formatNow } from '../utils/time.js';
import type { MarketData, SearchResult } from '../types/market.js';

const DATA_COLLECT_PROMPT = `你是美股市场数据采集专家。你的任务是从搜索结果中提取结构化的标普500和纳斯达克指数数据。

## 信息可靠性规则
1. 严禁捏造数据，只使用搜索到的真实数据
2. 每个关键数据点至少搜索2-3个不同来源交叉验证
3. 来源分级：
   - A级（权威）：交易所、美联储 → 直接采信
   - B级（可信）：CNBC、Yahoo Finance、MarketWatch、Investing.com → 采信但标注来源
   - C级（参考）：自媒体、论坛 → 仅作情绪参考
4. 所有数据必须标注获取时间和来源
5. 多来源数据差异>0.5%时，标注 ⚠️ 提醒

## 输出要求
请严格按照以下 JSON 格式输出：
{
  "timestamp": "数据时间ISO格式",
  "spx": {
    "price": { "value": 标普500点位, "change": 涨跌幅百分比, "source": "来源名", "sourceGrade": "A/B/C", "verifiedAt": "验证时间" },
    "high": { "value": 日内最高, "source": "来源名", "sourceGrade": "A/B/C", "verifiedAt": "时间" },
    "low": { "value": 日内最低, "source": "来源名", "sourceGrade": "A/B/C", "verifiedAt": "时间" },
    "pe": { "value": 市盈率, "source": "来源名", "sourceGrade": "A/B/C", "verifiedAt": "时间" },
    "dividend": { "value": 股息率, "source": "来源名", "sourceGrade": "A/B/C", "verifiedAt": "时间" }
  },
  "ixic": {
    "price": { "value": 纳斯达克点位, "change": 涨跌幅百分比, "source": "来源名", "sourceGrade": "A/B/C", "verifiedAt": "验证时间" },
    "high": { "value": 日内最高, "source": "来源名", "sourceGrade": "A/B/C", "verifiedAt": "时间" },
    "low": { "value": 日内最低, "source": "来源名", "sourceGrade": "A/B/C", "verifiedAt": "时间" }
  },
  "spy": {
    "code": "SPY", "name": "SPDR S&P 500 ETF",
    "nav": { "value": 净值, "change": 涨跌幅百分比, "source": "来源名", "sourceGrade": "A/B/C", "verifiedAt": "时间" },
    "premiumDiscount": { "value": 溢价率, "source": "来源名", "sourceGrade": "A/B/C", "verifiedAt": "时间" }
  },
  "qqq": {
    "code": "QQQ", "name": "Invesco QQQ Trust",
    "nav": { "value": 净值, "change": 涨跌幅百分比, "source": "来源名", "sourceGrade": "A/B/C", "verifiedAt": "时间" },
    "premiumDiscount": { "value": 溢价率, "source": "来源名", "sourceGrade": "A/B/C", "verifiedAt": "时间" }
  },
  "vix": {
    "value": { "value": VIX点数, "change": 涨跌幅百分比, "source": "来源名", "sourceGrade": "A/B/C", "verifiedAt": "时间" }
  },
  "dollarIndex": {
    "value": { "value": 美元指数, "change": 涨跌幅百分比, "source": "来源名", "sourceGrade": "A/B/C", "verifiedAt": "时间" }
  },
  "usTreasury": {
    "yield10y": { "value": 10年期收益率, "change": 涨跌幅, "source": "来源名", "sourceGrade": "A/B/C", "verifiedAt": "时间" },
    "yield2y": { "value": 2年期收益率, "change": 涨跌幅, "source": "来源名", "sourceGrade": "A/B/C", "verifiedAt": "时间" },
    "tips10y": { "value": TIPS实际利率, "source": "来源名", "sourceGrade": "A/B/C", "verifiedAt": "时间" }
  }
}

如果某个字段找不到数据，设为 null，不要编造。`;

export class DataCollectorAgent extends BaseAgent {
  private searchRouter: SearchRouter;

  constructor() {
    const config = getConfig();
    super({
      name: 'data-collector',
      model: config.models.dataCollector,
      systemPrompt: DATA_COLLECT_PROMPT,
    });
    this.searchRouter = new SearchRouter(config.search.tavilyApiKey);
  }

  async collectMarketData(): Promise<MarketData> {
    const searches = [
      { query: `S&P 500 SPX index level today ${new Date().getFullYear()}`, dataType: 'spx' },
      { query: `NASDAQ Composite IXIC index today`, dataType: 'ixic' },
      { query: `SPY ETF price NAV today`, dataType: 'spy' },
      { query: `QQQ ETF price NAV today`, dataType: 'qqq' },
      { query: `VIX volatility index today`, dataType: 'vix' },
      { query: `US dollar index DXY today`, dataType: 'dxy' },
      { query: `US 10 year 2 year treasury yield today`, dataType: 'us10y' },
    ];

    const searchResults = await this.searchRouter.searchBatch(searches, { numResults: 3 });

    // 反捏造防线：若所有搜索均无结果，则不应让 LLM 凭空"提取"市场数据，直接中止。
    const totalResults = Array.from(searchResults.values()).reduce((n, arr) => n + arr.length, 0);
    if (totalResults === 0) {
      throw new Error('搜索结果为空，无法采集市场数据。请配置 TAVILY_API_KEY 并确认网络连接；为避免编造数据，已中止本次采集。');
    }

    const MAX_SNIPPET = 300;
    const searchContext = Array.from(searchResults.entries())
      .map(([query, results]) => {
        const snippets = results
          .map(r => {
            const snip = r.snippet.length > MAX_SNIPPET ? r.snippet.slice(0, MAX_SNIPPET) + '...' : r.snippet;
            return `[${r.engine}] ${r.title}: ${snip}`;
          })
          .join('\n');
        return `搜索 "${query}" 结果:\n${snippets}`;
      })
      .join('\n\n');

    const schema = {
      type: 'object',
      properties: {
        timestamp: { type: 'string' },
        spx: { type: 'object', properties: {
          price: { type: 'object', properties: { value: { type: 'number' }, change: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
          high: { type: 'object', properties: { value: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
          low: { type: 'object', properties: { value: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
          pe: { type: 'object', properties: { value: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
          dividend: { type: 'object', properties: { value: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
        } },
        ixic: { type: 'object', properties: {
          price: { type: 'object', properties: { value: { type: 'number' }, change: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
          high: { type: 'object', properties: { value: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
          low: { type: 'object', properties: { value: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
        } },
        spy: { type: 'object', properties: {
          code: { type: 'string' }, name: { type: 'string' },
          nav: { type: 'object', properties: { value: { type: 'number' }, change: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
          premiumDiscount: { type: 'object', properties: { value: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
        } },
        qqq: { type: 'object', properties: {
          code: { type: 'string' }, name: { type: 'string' },
          nav: { type: 'object', properties: { value: { type: 'number' }, change: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
          premiumDiscount: { type: 'object', properties: { value: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
        } },
        vix: { type: 'object', properties: {
          value: { type: 'object', properties: { value: { type: 'number' }, change: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
        } },
        dollarIndex: { type: 'object', properties: {
          value: { type: 'object', properties: { value: { type: 'number' }, change: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
        } },
        usTreasury: { type: 'object', properties: {
          yield10y: { type: 'object', properties: { value: { type: 'number' }, change: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
          yield2y: { type: 'object', properties: { value: { type: 'number' }, change: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
          tips10y: { type: 'object', properties: { value: { type: 'number' }, source: { type: 'string' }, sourceGrade: { type: 'string' }, verifiedAt: { type: 'string' } } },
        } },
      },
      required: ['timestamp', 'spx', 'ixic', 'spy', 'qqq', 'vix', 'dollarIndex', 'usTreasury'],
    };

    const data = await this.structuredPrompt<MarketData>(
      `当前时间: ${formatNow()}\n\n请从以下搜索结果中提取美股指数数据:\n\n${searchContext}`,
      schema,
    );

    try {
      this.saveSnapshot(data);
    } catch (err) {
      console.error('保存快照失败:', err);
    }

    return data;
  }

  private saveSnapshot(data: MarketData): void {
    const db = getDb();
    const repo = new IndexPricesRepo(db);

    repo.upsert({
      date: todayDate(),
      spxClose: data.spx?.price?.value ?? null,
      spxHigh: data.spx?.high?.value ?? null,
      spxLow: data.spx?.low?.value ?? null,
      spxPe: data.spx?.pe?.value ?? null,
      ixicClose: data.ixic?.price?.value ?? null,
      ixicHigh: data.ixic?.high?.value ?? null,
      ixicLow: data.ixic?.low?.value ?? null,
      spyNav: data.spy?.nav?.value ?? null,
      spyChange: data.spy?.nav?.change ?? null,
      qqqNav: data.qqq?.nav?.value ?? null,
      qqqChange: data.qqq?.nav?.change ?? null,
      vix: data.vix?.value?.value ?? null,
      dollarIndex: data.dollarIndex?.value?.value ?? null,
      us10yYield: data.usTreasury?.yield10y?.value ?? null,
      us2yYield: data.usTreasury?.yield2y?.value ?? null,
      tipsYield: data.usTreasury?.tips10y?.value ?? null,
    });
  }
}
