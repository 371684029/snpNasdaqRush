// 配置类型定义

/** LLM 模型配置 */
export interface ModelConfig {
  providerID: string;
  modelID: string;
}

/** 投资视角 */
export type Horizon = 'short' | 'mid' | 'all';

/** 分析命令选项 */
export interface AnalysisOptions {
  horizon: Horizon;
  json: boolean;
  save: boolean;
  md: boolean;
}

/** 回测命令选项 */
export interface CalibrateOptions {
  days: number;
  detail: boolean;
}

/** 全局配置 */
export interface SnpRushConfig {
  models: {
    dataCollector: ModelConfig;
    validator: ModelConfig;
    technical: ModelConfig;
    fundamental: ModelConfig;
    sentiment: ModelConfig;
    etf: ModelConfig;
    rebuttal: ModelConfig;
    orchestrator: ModelConfig;
  };
  search: {
    tavilyApiKey: string;
    defaultResults: number;
    cacheMinutes: number;
  };
  database: {
    path: string;
  };
  investment: {
    defaultHorizon: Horizon;
    stopLossRange: [number, number];
    maxTailRiskIndex: number;
  };
}

/** 默认配置 */
export const DEFAULT_CONFIG: SnpRushConfig = {
  models: {
    dataCollector: { providerID: 'opencode-go', modelID: 'deepseek-v4-pro' },
    validator: { providerID: 'opencode-go', modelID: 'deepseek-v4-pro' },
    technical: { providerID: 'opencode-go', modelID: 'deepseek-v4-pro' },
    fundamental: { providerID: 'opencode-go', modelID: 'deepseek-v4-pro' },
    sentiment: { providerID: 'opencode-go', modelID: 'deepseek-v4-pro' },
    etf: { providerID: 'opencode-go', modelID: 'deepseek-v4-pro' },
    rebuttal: { providerID: 'opencode-go', modelID: 'deepseek-v4-pro' },
    orchestrator: { providerID: 'opencode-go', modelID: 'deepseek-v4-pro' },
  },
  search: {
    tavilyApiKey: '',
    defaultResults: 5,
    cacheMinutes: 5,
  },
  database: {
    path: './data/snprush.db',
  },
  investment: {
    defaultHorizon: 'all',
    stopLossRange: [3, 5],
    maxTailRiskIndex: 20,
  },
};
