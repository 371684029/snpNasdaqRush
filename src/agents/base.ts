// Agent 基类 — 通过 opencode HTTP API 调用 LLM
import type { ModelConfig } from '../types/config.js';

const OPENCODE_SERVER = process.env.OPENCODE_SERVER || 'http://localhost:16688';
const OPENCODE_USERNAME = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
const OPENCODE_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD || 'snprush2026';

function authHeader(): string {
  return 'Basic ' + Buffer.from(`${OPENCODE_USERNAME}:${OPENCODE_PASSWORD}`).toString('base64');
}

export interface AgentOptions {
  name: string;
  model: ModelConfig;
  systemPrompt?: string;
}

export class BaseAgent {
  protected name: string;
  protected model: ModelConfig;
  protected systemPrompt: string;

  constructor(options: AgentOptions) {
    this.name = options.name;
    this.model = options.model;
    this.systemPrompt = options.systemPrompt ?? '';
  }

  /** 创建新 session */
  private async createSession(): Promise<string> {
    const res = await fetch(`${OPENCODE_SERVER}/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader(),
      },
    });

    if (!res.ok) {
      throw new Error(`Agent ${this.name}: create session failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json() as { id: string };
    return data.id;
  }

  /** 发送消息到 session，等待完整回复 */
  private async sendMessage(sessionId: string, content: string, system?: string): Promise<string> {
    const body: Record<string, unknown> = {
      providerID: this.model.providerID,
      modelID: this.model.modelID,
      parts: [{ type: 'text', text: content }],
    };
    if (system) {
      body.system = system;
    }

    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(`${OPENCODE_SERVER}/session/${sessionId}/message`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader(),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(300_000),
        });

        if (!res.ok) {
          throw new Error(`Agent ${this.name}: send message failed: ${res.status} ${await res.text()}`);
        }

        const data = await res.json() as { parts: Array<{ type: string; text?: string }> };
        const textParts = (data.parts || [])
          .filter((p) => p.type === 'text' && p.text)
          .map((p) => p.text!)
          .join('\n');

        if (!textParts.trim()) {
          throw new Error(`Agent ${this.name}: empty response from LLM`);
        }

        return textParts;
      } catch (err) {
        const isLastAttempt = attempt === maxRetries;
        if (isLastAttempt) throw err;
        const delay = attempt * 5000;
        console.error(`  ⚠️ Agent ${this.name} attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)}. Retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    throw new Error(`Agent ${this.name}: all retries exhausted`);
  }

  /** 发送 prompt，获取文本回复 */
  async prompt(content: string): Promise<string> {
    const sessionId = await this.createSession();
    const text = await this.sendMessage(sessionId, content, this.systemPrompt || undefined);
    return text.trim();
  }

  /** 发送 prompt，获取结构化 JSON 输出 */
  async structuredPrompt<T>(content: string, _schema: Record<string, unknown>): Promise<T> {
    const jsonInstruction = `\n\n请严格按照上述 JSON 格式输出，不要包含任何其他文本。直接输出 JSON，不要用 markdown 代码块包裹。JSON中不要包含tab、换行等控制字符。`;
    const fullContent = content + jsonInstruction;

    const text = await this.prompt(fullContent);

    function tryParse(raw: string): T | null {
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    }

    function deepClean(s: string): string {
      let r = s
        .replace(/[\x00-\x1f]/g, ' ')
        .replace(/\\\n/g, '')
        .replace(/\\t/g, ' ')
        .replace(/\u201c/g, '"')
        .replace(/\u201d/g, '"')
        .replace(/\u2018/g, "'")
        .replace(/\u2019/g, "'")
        .replace(/，/g, ',')
        .replace(/,(\s*[}\]])/g, '$1')
        .replace(/\s{2,}/g, ' ')
        .trim();

      r = r.replace(/\\([^"\\\/bfnrtu])/g, (_, c) => c);
      return r;
    }

    // 1. 深度清洁后直接解析
    let cleaned = deepClean(text);
    let parsed = tryParse(cleaned);
    if (parsed) return parsed;

    // 2. 从 markdown 代码块提取
    const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      parsed = tryParse(deepClean(codeBlockMatch[1]));
      if (parsed) return parsed;
    }

    // 3. 提取最外层 JSON 对象 + 状态机修复
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const jsonStr = jsonMatch[0];

      parsed = tryParse(jsonStr);
      if (parsed) return parsed;

      // 状态机修复未转义引号
      let fixed = '';
      let inString = false;
      let escapeNext = false;
      for (let i = 0; i < jsonStr.length; i++) {
        const ch = jsonStr[i];
        if (escapeNext) {
          fixed += ch;
          escapeNext = false;
          continue;
        }
        if (ch === '\\') {
          fixed += ch;
          escapeNext = true;
          continue;
        }
        if (ch === '"') {
          if (inString) {
            const nextNonSpace = jsonStr.slice(i + 1).match(/\S/);
            const nextCh = nextNonSpace ? nextNonSpace[0] : '';
            if (nextCh === ',' || nextCh === '}' || nextCh === ']' || nextCh === ':' || nextCh === '') {
              inString = false;
              fixed += ch;
            } else {
              fixed += '\\"';
            }
          } else {
            inString = true;
            fixed += ch;
          }
          continue;
        }
        fixed += ch;
      }
      parsed = tryParse(fixed);
      if (parsed) return parsed;
    }

    const diag = (() => {
      try {
        JSON.parse(cleaned);
        return '无错误';
      } catch (e) {
        const msg = String(e);
        const posMatch = msg.match(/(?:position|at)\s*(\d+)/i);
        if (posMatch) {
          const pos = parseInt(posMatch[1], 10);
          const start = Math.max(0, pos - 40);
          const end = Math.min(cleaned.length, pos + 40);
          return `位置 ${pos}: ...${JSON.stringify(cleaned.slice(start, end))}...`;
        }
        return msg.slice(0, 200);
      }
    })();

    // 4. 最后兜底:把原始输出回喂给 LLM,要求自身修复 JSON 语法
    try {
      const repairPrompt =
        `你上一条回复不是合法 JSON,JSON.parse 失败于 ${diag}。\n` +
        `请只输出修复后的完整 JSON(以 { 开头,以 } 结尾),不要任何解释、不要 markdown 代码块。\n` +
        `常见问题:数组元素缺少引号包裹(如数字+中文混合 such as -8.27%月跌幅)、字段名未加引号、字符串内部出现未转义的双引号。\n` +
        `请确保所有字符串值都用双引号包裹,字符串内的双引号用 \\" 转义。\n\n` +
        `原始输出(需要修复):\n${text}`;
      const repairedText = await this.prompt(repairPrompt);

      const repairedClean = deepClean(repairedText);
      parsed = tryParse(repairedClean);
      if (parsed) return parsed;

      const repairedCodeBlock = repairedClean.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (repairedCodeBlock) {
        parsed = tryParse(deepClean(repairedCodeBlock[1]));
        if (parsed) return parsed;
      }
      const repairedJsonMatch = repairedClean.match(/\{[\s\S]*\}/);
      if (repairedJsonMatch) {
        parsed = tryParse(repairedJsonMatch[0]);
        if (parsed) return parsed;
      }
    } catch {
      // self-heal 自身失败就放弃,继续抛原错
    }

    throw new Error(`Agent ${this.name}: Failed to parse structured output.\n  JSON解析错误: ${diag}\n  前300字符: ${text.slice(0, 300)}`);
  }

  async cleanup(): Promise<void> {
    // no-op
  }
}
