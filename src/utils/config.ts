// 配置管理

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG, type SnpRushConfig } from '../types/config.js';

const CONFIG_FILENAME = 'snprush.config.json';

let config: SnpRushConfig | null = null;

/** 加载配置 */
export function loadConfig(configPath?: string): SnpRushConfig {
  if (config) return config;

  const resolvedPath = configPath ?? path.resolve(process.cwd(), CONFIG_FILENAME);
  let loaded: SnpRushConfig;

  if (fs.existsSync(resolvedPath)) {
    try {
      const raw = fs.readFileSync(resolvedPath, 'utf-8');
      const userConfig = JSON.parse(raw);
      loaded = { ...DEFAULT_CONFIG, ...userConfig };
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

/** 保存配置 */
export function saveConfig(cfg: Partial<SnpRushConfig>): void {
  const current = loadConfig();
  const merged = { ...current, ...cfg };
  const resolvedPath = path.resolve(process.cwd(), CONFIG_FILENAME);
  fs.writeFileSync(resolvedPath, JSON.stringify(merged, null, 2), 'utf-8');
  config = merged;
}
