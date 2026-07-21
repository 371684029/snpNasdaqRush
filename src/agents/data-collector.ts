// 数据采集 Agent — Yahoo 锚定 + Tavily 搜索 + Zod 校验 + 拒零入库
// 对齐 apple-gold-rush 反幻觉防线

import { BaseAgent } from './base.js';
import { getConfig } from '../utils/config.js';
import { getDb } from '../db/index.js';
import { IndexPricesRepo } from '../db/index-prices.js';
import { SearchRouter } from '../data/search-router.js';
import { fetchAllLiveEquity } from '../data/yahoo-live.js';
import { parseMarketData, isMissingPrice, isValidMarketNumber } from '../schemas/market.js';
import { archiveSearchRaw, toArchiveEntries } from '../utils/search-raw-archive.js';
import { todayDate, formatNow } from '../utils/time.js';
import type { MarketData, SourcedPrice } from '../types/market.js';

const DATA_COLLECT_PROMPT = `你是美股市场数据采集专家。你的任务是从搜索结果中提取结构化的标普500和纳斯达克指数数据。

## 信息可靠性规则
1. 严禁捏造数据，只使用搜索到的真实数据
2. 每个关键数据点至少搜索2-3个不同来源交叉验证
3. 来源分级：
   - A级（权威）：交易所、美联储、Yahoo Finance → 直接采信
   - B级（可信）：CNBC、MarketWatch、Investing.com → 采信但标注来源
   - C级（参考）：自媒体、论坛 → 仅作情绪参考
4. 所有数据必须标注获取时间和来源
5. 多来源数据差异>0.5%时，标注 ⚠️ 提醒
6. 找不到的字段设为 null，不要写 0，不要编造

## 输出要求
请严格按照以下 JSON 格式输出（找不到设 null）：
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
}`;

function toSourced(price: number, change: number, source: string): SourcedPrice {
  return {
    value: price,
    change,
    source,
    sourceGrade: 'A',
    verifiedAt: new Date().toISOString(),
  };
}

export class DataCollectorAgent extends BaseAgent {
  private searchRouter: SearchRouter;
  /** Yahoo 锚定 SPX 价，供门禁对比 */
  lastAnchorSpx: number | null = null;

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
    // Step 0: Yahoo 实时锚定（零 LLM）
    console.log('  ⚓ Yahoo 实时锚定...');
    const live = await fetchAllLiveEquity();
    this.lastAnchorSpx = live.spx?.price ?? null;
    if (live.spx) console.log(`     SPX=${live.spx.price} (Yahoo ${live.spx.symbol})`);
    if (live.ixic) console.log(`     IXIC=${live.ixic.price}`);
    if (live.vix) console.log(`     VIX=${live.vix.price}`);

    const year = new Date().getFullYear();
    const searches = [
      { query: `S&P 500 SPX index level today ${year}`, dataType: 'spx' },
      { query: `NASDAQ Composite IXIC index today`, dataType: 'ixic' },
      { query: `SPY ETF price NAV today`, dataType: 'spy' },
      { query: `QQQ ETF price NAV today`, dataType: 'qqq' },
      { query: `VIX volatility index today`, dataType: 'vix' },
      { query: `US dollar index DXY today`, dataType: 'dxy' },
      { query: `US 10 year 2 year treasury yield today`, dataType: 'us10y' },
      { query: `S&P 500 forward PE ratio CAPE today`, dataType: 'pe' },
    ];

    const searchResults = await this.searchRouter.searchBatch(searches, { numResults: 3 });

    // 搜索原文存档（审计）
    const archiveItems = searches.map(s => ({
      query: s.query,
      dataType: s.dataType,
      results: searchResults.get(s.query) ?? [],
    }));
    archiveSearchRaw(toArchiveEntries(archiveItems));

    // 反捏造防线：全部搜索为空且无 Yahoo 锚定 → fail-fast
    const totalHits = Array.from(searchResults.values()).reduce((n, r) => n + r.length, 0);
    const hasAnchor = live.spx != null || live.ixic != null;
    if (totalHits === 0 && !hasAnchor) {
      throw new Error(
        '数据采集失败：搜索结果为空且无 Yahoo 锚定。请配置 TAVILY_API_KEY 或检查网络/Yahoo 可达性。严禁无据让 LLM 捏造数据。',
      );
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
        return `搜索 "${query}" 结果:\n${snippets || '(无结果)'}`;
      })
      .join('\n\n');

    const anchorContext = [
      live.spx ? `Yahoo锚定 SPX=${live.spx.price} (涨跌${live.spx.change}%)` : null,
      live.ixic ? `Yahoo锚定 IXIC=${live.ixic.price}` : null,
      live.spy ? `Yahoo锚定 SPY=${live.spy.price}` : null,
      live.qqq ? `Yahoo锚定 QQQ=${live.qqq.price}` : null,
      live.vix ? `Yahoo锚定 VIX=${live.vix.price}` : null,
      live.dxy ? `Yahoo锚定 DXY=${live.dxy.price}` : null,
      live.us10y ? `Yahoo锚定 10Y=${live.us10y.price}%` : null,
    ].filter(Boolean).join('\n');

    const schema = {
      type: 'object',
      properties: {
        timestamp: { type: 'string' },
        spx: { type: 'object' },
        ixic: { type: 'object' },
        spy: { type: 'object' },
        qqq: { type: 'object' },
        vix: { type: 'object' },
        dollarIndex: { type: 'object' },
        usTreasury: { type: 'object' },
      },
      required: ['timestamp', 'spx', 'ixic', 'spy', 'qqq', 'vix', 'dollarIndex', 'usTreasury'],
    };

    let raw: unknown;
    if (totalHits > 0) {
      raw = await this.structuredPrompt<unknown>(
        `当前时间: ${formatNow()}\n\n## 直连锚定（优先采信）\n${anchorContext || '无'}\n\n请从以下搜索结果中提取美股指数数据（找不到写 null，严禁写 0）:\n\n${searchContext}`,
        schema,
      );
    } else {
      // 仅有锚定：构造最小结构，不调 LLM
      raw = {
        timestamp: new Date().toISOString(),
        spx: live.spx ? { price: toSourced(live.spx.price, live.spx.change, 'Yahoo ^GSPC') } : null,
        ixic: live.ixic ? { price: toSourced(live.ixic.price, live.ixic.change, 'Yahoo ^IXIC') } : null,
        spy: live.spy ? { code: 'SPY', name: 'SPDR S&P 500 ETF', nav: toSourced(live.spy.price, live.spy.change, 'Yahoo SPY') } : null,
        qqq: live.qqq ? { code: 'QQQ', name: 'Invesco QQQ Trust', nav: toSourced(live.qqq.price, live.qqq.change, 'Yahoo QQQ') } : null,
        vix: live.vix ? { value: toSourced(live.vix.price, live.vix.change, 'Yahoo ^VIX') } : null,
        dollarIndex: live.dxy ? { value: toSourced(live.dxy.price, live.dxy.change, 'Yahoo DXY') } : null,
        usTreasury: {
          yield10y: live.us10y ? toSourced(live.us10y.price, live.us10y.change, 'Yahoo ^TNX') : null,
          yield2y: null,
          tips10y: null,
        },
      };
    }

    let data = parseMarketData(raw);
    data = this.enrichWithLiveAnchors(data, live);

    try {
      this.saveSnapshot(data);
    } catch (err) {
      console.error('保存快照失败:', err);
    }

    return data;
  }

  /** 仅补缺失字段，不盲目覆盖已有有效提取 */
  private enrichWithLiveAnchors(
    data: MarketData,
    live: Awaited<ReturnType<typeof fetchAllLiveEquity>>,
  ): MarketData {
    const fill = (current: SourcedPrice | undefined, livePx: { price: number; change: number } | null | undefined, label: string): SourcedPrice | undefined => {
      if (!isMissingPrice(current) && isValidMarketNumber(current?.value)) return current;
      if (!livePx) return current;
      return toSourced(livePx.price, livePx.change, label);
    };

    return {
      ...data,
      spx: {
        ...data.spx,
        price: fill(data.spx?.price, live.spx, 'Yahoo ^GSPC') ?? data.spx.price,
      },
      ixic: {
        ...data.ixic,
        price: fill(data.ixic?.price, live.ixic, 'Yahoo ^IXIC') ?? data.ixic.price,
      },
      spy: {
        ...data.spy,
        nav: fill(data.spy?.nav, live.spy, 'Yahoo SPY') ?? data.spy.nav,
      },
      qqq: {
        ...data.qqq,
        nav: fill(data.qqq?.nav, live.qqq, 'Yahoo QQQ') ?? data.qqq.nav,
      },
      vix: {
        value: fill(data.vix?.value, live.vix, 'Yahoo ^VIX') ?? data.vix.value,
      },
      dollarIndex: {
        value: fill(data.dollarIndex?.value, live.dxy, 'Yahoo DXY') ?? data.dollarIndex.value,
      },
      usTreasury: {
        ...data.usTreasury,
        yield10y: fill(data.usTreasury?.yield10y, live.us10y, 'Yahoo ^TNX') ?? data.usTreasury.yield10y,
      },
    };
  }

  private saveSnapshot(data: MarketData): void {
    const db = getDb();
    const repo = new IndexPricesRepo(db);

    // 拒零：isValidMarketNumber 过滤
    const val = (p?: { value: number } | null): number | null =>
      p && isValidMarketNumber(p.value) ? p.value : null;

    repo.upsert({
      date: todayDate(),
      spxClose: val(data.spx?.price),
      spxHigh: val(data.spx?.high),
      spxLow: val(data.spx?.low),
      spxPe: val(data.spx?.pe),
      ixicClose: val(data.ixic?.price),
      ixicHigh: val(data.ixic?.high),
      ixicLow: val(data.ixic?.low),
      spyNav: val(data.spy?.nav),
      spyChange: data.spy?.nav?.change ?? null,
      qqqNav: val(data.qqq?.nav),
      qqqChange: data.qqq?.nav?.change ?? null,
      vix: val(data.vix?.value),
      dollarIndex: val(data.dollarIndex?.value),
      us10yYield: val(data.usTreasury?.yield10y),
      us2yYield: val(data.usTreasury?.yield2y),
      tipsYield: data.usTreasury?.tips10y && isValidMarketNumber(data.usTreasury.tips10y.value)
        ? data.usTreasury.tips10y.value
        : (data.usTreasury?.tips10y?.value != null
            && Number.isFinite(data.usTreasury.tips10y.value)
            && data.usTreasury.tips10y.value !== 0
            && data.usTreasury.tips10y.source !== 'N/A'
          ? data.usTreasury.tips10y.value
          : null),
    });
  }
}
