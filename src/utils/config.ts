// 配置管理

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG, type SnpRushConfig } from '../types/config.js';

const CONFIG_FILENAME = 'snprush.config.json';

let config: SnpRushConfig | null = null;

/** 深度合并：用 source 的值覆盖 target，嵌套对象递归处理 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Record<string, unknown>): T {
  const result = { ...target } as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key as keyof T];
    if (
      sv !== null &&
      typeof sv === 'object' &&
      !Array.isArray(sv) &&
      tv !== null &&
      typeof tv === 'object' &&
      !Array.isArray(tv)
    ) {
      result[key] = deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>);
    } else if (sv !== undefined) {
      result[key] = sv;
    }
  }
  return result as T;
}

/** 加载配置 */
export function loadConfig(configPath?: string): SnpRushConfig {
  if (config) return config;

  const resolvedPath = configPath ?? path.resolve(process.cwd(), CONFIG_FILENAME);
  let loaded: SnpRushConfig;

  if (fs.existsSync(resolvedPath)) {
    try {
      const raw = fs.readFileSync(resolvedPath, 'utf-8');
      const userConfig = JSON.parse(raw) as Record<string, unknown>;
      loaded = deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, userConfig) as unknown as SnpRushConfig;
    } catch {
      loaded = { ...DEFAULT_CONFIG };
    }
  } else {
    loaded = { ...DEFAULT_CONFIG };
  }

  // 从环境变量覆盖
  if (process.env.TAVILY_API_KEY) {
    loaded.search.tavilyApiKey = process.env.TAVILY_API_KEY;
  }

  config = loaded;
  return config;
}

/** 获取当前配置 */
export function getConfig(): SnpRushConfig {
  return loadConfig();
}

/** 保存配置（只写 models/search/database/investment 四个顶层字段）*/
export function saveConfig(cfg: Partial<SnpRushConfig>): void {
  const current = loadConfig();
  const merged = deepMerge(
    current as unknown as Record<string, unknown>,
    cfg as Record<string, unknown>,
  ) as unknown as SnpRushConfig;
  const resolvedPath = path.resolve(process.cwd(), CONFIG_FILENAME);
  fs.writeFileSync(resolvedPath, JSON.stringify(merged, null, 2), 'utf-8');
  config = merged;
}
