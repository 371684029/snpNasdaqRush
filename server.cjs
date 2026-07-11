#!/usr/bin/env node
// SnpRush Docs Server — 展示 docs/ 下的分析报告，带评分可视化

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 81;
const DOCS_DIR = path.join(__dirname, 'docs');

// ===== 评分提取 =====

function extractScore(md) {
  const m = md.match(/评分[：:]\s*\*{0,2}(\d+)/);
  if (!m) return null;
  const score = parseInt(m[1], 10);
  const dirMatch = md.match(/方向[：:]?\s*\*{0,2}(bullish|bearish|neutral|📈|📉|➡️)[^*]*/);
  let direction = 'neutral';
  if (dirMatch) {
    const d = dirMatch[1];
    if (d.includes('bullish') || d.includes('📈')) direction = 'bullish';
    else if (d.includes('bearish') || d.includes('📉')) direction = 'bearish';
  }
  return { score, direction };
}

function extractDimensionScores(md) {
  const dims = [];
  const pattern = /(技术面|基本面|情绪面|ETF\/板块).*?(\d+)\/100/g;
  let m;
  while ((m = pattern.exec(md)) !== null) {
    dims.push({ name: m[1], score: parseInt(m[2], 10) });
  }
  return dims;
}

function scoreBar(score) {
  const filled = Math.round(score / 100 * 12);
  const empty = 12 - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const color = score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#ef4444';
  return `<span style="color:${color};font-family:monospace">${bar}</span>`;
}

function quickAdvice(score, direction) {
  const d = direction || (score >= 58 ? 'bullish' : score <= 42 ? 'bearish' : 'neutral');
  if (d === 'bullish') return { emoji: '📈', label: '偏多', action: '维持仓位；回调至支撑位可小幅加仓', color: '#22c55e' };
  if (d === 'bearish') return { emoji: '📉', label: '偏空', action: '暂不加仓，设好止损；等评分回升再入场', color: '#ef4444' };
  return { emoji: '➡️', label: '中性', action: '维持现有仓位，按纪律执行，少择时', color: '#f59e0b' };
}

function extractScenarios(md) {
  const names = [
    { key: '基准', cls: 'base', icon: '⚖️' },
    { key: '上行', cls: 'up', icon: '📈' },
    { key: '下行', cls: 'down', icon: '📉' },
  ];
  const out = [];
  for (const { key, cls, icon } of names) {
    const row = md.match(new RegExp(`\\| \\*\\*${key}\\*\\* \\| ([^|]+) \\| ([^|]+) \\| ([^|]+)`));
    if (!row) continue;
    const prob = parseInt(String(row[1]).replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(prob)) continue;
    out.push({ name: key, cls, icon, probability: prob, action: row[3].trim().slice(0, 60) });
  }
  return out.length === 3 ? out : null;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderIndex(files) {
  // 读取每个报告提取评分
  const reports = files.map(f => {
    const stats = fs.statSync(path.join(DOCS_DIR, f));
    const raw = fs.readFileSync(path.join(DOCS_DIR, f), 'utf-8');
    const scoreInfo = extractScore(raw);
    const dims = extractDimensionScores(raw);
    const dateStr = stats.mtime.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const dateLabel = f.replace('snprush-analysis-', '').replace('.md', '');
    return { filename: f, dateStr, dateLabel, sizeKB: (stats.size / 1024).toFixed(1), scoreInfo, dims };
  });

  const latest = reports[0];
  const rest = reports.slice(1);

  // Hero card — 最新研判 (goldRush-style)
  const heroHtml = latest?.scoreInfo ? `<a href="/${latest.filename}" class="hero-card dir-${latest.scoreInfo.direction || 'neutral'}">
    <div class="hero-badge">最新研判</div>
    <div class="hero-left">${scoreBadge(latest.scoreInfo.score)}</div>
    <div class="hero-body">
      <div class="hero-date">${esc(latest.dateLabel)}</div>
      <div class="hero-dims">${latest.dims.map(d => `<span class="h-dim-tag">${d.name} ${d.score}</span>`).join('')}</div>
    </div>
    <div class="hero-arrow">→</div>
  </a>` : '';

  // 历史报告卡片
  const cardRows = rest.map(r => {
    const s = r.scoreInfo;
    return `<a href="/${r.filename}" class="report-card dir-${s?.direction || 'neutral'}">
      <div class="rc-score">${scoreBadge(s?.score ?? null)}</div>
      <div class="rc-body">
        <div class="rc-date">${r.dateLabel}</div>
        <div class="rc-meta">${r.sizeKB} KB · ${r.dateStr}</div>
      </div>
    </a>`;
  }).join('\n');

  const total = reports.length;
  const bullish = reports.filter(r => r.scoreInfo?.direction === 'bullish').length;
  const bearish = reports.filter(r => r.scoreInfo?.direction === 'bearish').length;
  const neutral = reports.filter(r => r.scoreInfo && r.scoreInfo.direction !== 'bullish' && r.scoreInfo.direction !== 'bearish').length;
  const avgScore = total > 0 ? Math.round(reports.reduce((s, r) => s + (r.scoreInfo?.score ?? 50), 0) / total) : '—';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>📊 SnpRush 分析报告</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif; background: linear-gradient(135deg, #0b1120 0%, #0f172a 50%, #0a0f1a 100%); color: #e2e8f0; min-height: 100vh; }
    .container { max-width: 960px; margin: 0 auto; padding: 32px 20px 48px; }
    header { text-align: center; padding: 32px 0 40px; position: relative; }
    header::after { content: ''; position: absolute; bottom: 0; left: 50%; transform: translateX(-50%); width: 80px; height: 2px; background: linear-gradient(90deg, transparent, #3b82f6, transparent); }
    header h1 { font-size: 2rem; background: linear-gradient(135deg, #60a5fa, #2563eb); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: 800; letter-spacing: 1px; }
    header .subtitle { color: #64748b; margin-top: 10px; font-size: 0.9rem; letter-spacing: 2px; }
    .stats { display: flex; justify-content: center; gap: 16px; margin: 36px 0 28px; flex-wrap: wrap; }
    .stat-card { background: linear-gradient(135deg, #1e293b, #1a2332); border: 1px solid #2d3a4e; border-radius: 14px; padding: 16px 24px; text-align: center; min-width: 100px; transition: transform 0.2s; }
    .stat-card:hover { transform: translateY(-2px); border-color: #3b82f644; }
    .stat-card .num { font-size: 1.5rem; font-weight: 700; }
    .stat-card .num.green { color: #22c55e; }
    .stat-card .num.yellow { color: #f59e0b; }
    .stat-card .num.red { color: #ef4444; }
    .stat-card .num.blue { color: #60a5fa; }
    .stat-card .label { font-size: 0.7rem; color: #64748b; margin-top: 4px; text-transform: uppercase; letter-spacing: 1px; }
    /* Hero card */
    .hero-card { display: flex; align-items: center; gap: 20px; background: linear-gradient(135deg, #1a2744, #1e293b, #172033); border: 1px solid #334155; border-radius: 18px; padding: 24px 28px; margin-bottom: 24px; text-decoration: none; color: inherit; transition: transform 0.2s, border-color 0.2s; position: relative; overflow: hidden; }
    .hero-card::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: #f59e0b; }
    .hero-card.dir-bullish::before { background: linear-gradient(180deg, #22c55e, #16a34a); }
    .hero-card.dir-bearish::before { background: linear-gradient(180deg, #ef4444, #dc2626); }
    .hero-card:hover { transform: translateY(-3px); border-color: #f59e0b55; box-shadow: 0 12px 40px #00000044; }
    .hero-badge { position: absolute; top: 12px; right: 16px; font-size: 0.65rem; font-weight: 700; letter-spacing: 1px; color: #fbbf24; background: #f59e0b18; border: 1px solid #f59e0b33; padding: 3px 10px; border-radius: 20px; }
    .hero-left { flex-shrink: 0; }
    .hero-body { flex: 1; min-width: 0; }
    .hero-date { font-size: 0.82rem; color: #64748b; letter-spacing: 0.5px; margin-bottom: 10px; }
    .hero-dims { display: flex; flex-wrap: wrap; gap: 6px; }
    .h-dim-tag { display: inline-block; background: #1a2332; border: 1px solid #2d3a4e; border-radius: 6px; padding: 2px 8px; font-size: 0.7rem; color: #94a3b8; }
    .hero-arrow { font-size: 1.4rem; color: #475569; flex-shrink: 0; }
    /* Score badge */
    .s-badge { display: inline-flex; align-items: center; gap: 4px; padding: 4px 12px; border-radius: 20px; font-weight: 700; font-size: 1.05rem; border: 1px solid; white-space: nowrap; }
    .s-badge .s-label { font-size: 0.65rem; font-weight: 500; opacity: 0.85; }
    /* Report cards */
    .card-grid { display: flex; flex-direction: column; gap: 10px; }
    .report-card { display: flex; align-items: flex-start; gap: 14px; background: #1e293b; border: 1px solid #2d3a4e; border-radius: 12px; padding: 14px 16px; text-decoration: none; color: inherit; transition: background 0.15s, border-color 0.15s; border-left: 3px solid #475569; }
    .report-card.dir-bullish { border-left-color: #22c55e; }
    .report-card.dir-bearish { border-left-color: #ef4444; }
    .report-card.dir-neutral { border-left-color: #f59e0b; }
    .report-card:hover { background: #243045; border-color: #475569; }
    .rc-score { flex-shrink: 0; }
    .rc-body { flex: 1; min-width: 0; }
    .rc-date { font-weight: 600; color: #e2e8f0; font-size: 0.95rem; }
    .rc-meta { font-size: 0.72rem; color: #64748b; margin-top: 4px; }
    .section-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 1.5px; color: #64748b; margin: 20px 0 12px; font-weight: 600; }
    footer { text-align: center; margin-top: 48px; padding: 24px 0; color: #475569; font-size: 0.78rem; }
    .empty { text-align: center; padding: 60px 20px; color: #64748b; }
    .empty .icon { font-size: 3rem; margin-bottom: 16px; }
    @media (max-width: 768px) {
      .container { padding: 20px 14px; }
      header h1 { font-size: 1.5rem; }
      .stats { gap: 8px; }
      .stat-card { padding: 12px 16px; min-width: 80px; }
      .hero-card { flex-direction: column; align-items: flex-start; padding: 20px; }
      .hero-arrow { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>📊 SnpRush</h1>
      <p class="subtitle">标普500 & 纳斯达克 · 每日分析报告</p>
    </header>
    <div class="stats">
      <div class="stat-card"><div class="num blue">${total}</div><div class="label">报告</div></div>
      ${total > 0 ? `
      <div class="stat-card"><div class="num green">${bullish}</div><div class="label">偏多</div></div>
      <div class="stat-card"><div class="num yellow">${neutral}</div><div class="label">中性</div></div>
      <div class="stat-card"><div class="num red">${bearish}</div><div class="label">偏空</div></div>
      <div class="stat-card"><div class="num blue">${avgScore}</div><div class="label">均分</div></div>
      ` : ''}
    </div>
    ${total > 0 ? `${heroHtml}
    ${rest.length ? `<div class="section-label">历史日报</div><div class="card-grid">${cardRows}</div>` : ''}` : `<div class="empty"><div class="icon">📭</div><p>暂无分析报告<br>运行 <code>node dist/index.js analysis --md</code> 生成第一份</p></div>`}
    <footer><p>报告由 SnpRush 自动生成 · 仅供研究参考，不构成投资建议</p></footer>
  </div>
</body>
</html>`;
}

function scoreBadge(score) {
  if (score == null) return '<span class="s-badge" style="background:#47556922;color:#64748b;border-color:#47556944">—</span>';
  let color, label;
  if (score >= 70) { color = '#22c55e'; label = '偏多'; }
  else if (score >= 40) { color = '#f59e0b'; label = '中性'; }
  else { color = '#ef4444'; label = '偏空'; }
  return `<span class="s-badge" style="background:${color}22;color:${color};border-color:${color}44">${score}<span class="s-label">${label}</span></span>`;
}

function renderArticle(mdFilename, rawMarkdown) {
  const dateLabel = mdFilename.replace('snprush-analysis-', '').replace('.md', '');
  const scoreInfo = extractScore(rawMarkdown);
  const dims = extractDimensionScores(rawMarkdown);
  const advice = scoreInfo ? quickAdvice(scoreInfo.score, scoreInfo.direction) : null;
  const scenarios = extractScenarios(rawMarkdown);

  // 预测仪表盘
  const dashboardHtml = scoreInfo ? `
  <section class="pred-dashboard">
    <div class="pred-hero" style="--accent:${advice.color}">
      <div class="pred-score">
        <div class="pred-num">${scoreInfo.score}</div>
        <div class="pred-sub">综合分 / 100</div>
        <div class="pred-meter"><div class="pred-fill" style="width:${scoreInfo.score}%;background:${advice.color}"></div></div>
      </div>
      <div class="pred-body">
        <div class="pred-emoji">${advice.emoji}</div>
        <div class="pred-label">${advice.label}</div>
        <div class="pred-action">${esc(advice.action)}</div>
      </div>
      <div class="pred-meta">
        ${dims.map(d => `<span class="dim-chip">${d.name} ${d.score}</span>`).join('')}
      </div>
    </div>
    ${scenarios ? `<div class="pred-scenarios">
      <div class="sc-title">三情景概率</div>
      <div class="sc-grid">
        ${scenarios.map(s => `<div class="sc-card sc-${s.cls}"><span class="sc-icon">${s.icon}</span><span class="sc-name">${esc(s.name)}</span><span class="sc-pct">${s.probability}%</span><div class="sc-action">${esc(s.action)}</div></div>`).join('')}
      </div>
    </div>` : ''}
  </section>` : '';

  const dimBars = dims.map(d => {
    const c = d.score >= 70 ? '#22c55e' : d.score >= 40 ? '#f59e0b' : '#ef4444';
    return `<div class="dim-bar"><span class="dim-name">${d.name}</span><div class="dim-bg"><div class="dim-fill" style="width:${d.score}%;background:${c}"></div></div><span class="dim-val">${d.score}</span></div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(dateLabel)} — SnpRush 分析报告</title>
  <script src="https://cdn.jsdelivr.net/npm/marked@12/marked.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", -apple-system, sans-serif; background: #0b1120; color: #cbd5e1; line-height: 1.8; }
    .topbar { position: sticky; top: 0; z-index: 100; background: rgba(11, 17, 32, 0.88); backdrop-filter: blur(16px); border-bottom: 1px solid #1e293b; padding: 0 24px; height: 56px; display: flex; align-items: center; justify-content: space-between; }
    .topbar a { color: #94a3b8; text-decoration: none; font-size: 0.88rem; display: flex; align-items: center; gap: 6px; transition: color 0.2s; }
    .topbar a:hover { color: #60a5fa; }
    .topbar .logo { font-weight: 700; font-size: 1rem; color: #60a5fa; }
    .topbar .report-date { color: #64748b; font-size: 0.82rem; }
    .article-layout { max-width: 1100px; margin: 0 auto; padding: 32px 24px 80px; display: flex; gap: 36px; align-items: flex-start; }
    .article-main { flex: 1; min-width: 0; }
    /* 预测仪表盘 */
    .pred-dashboard { background: linear-gradient(135deg, #1a2744, #1e293b, #172033); border: 1px solid #334155; border-radius: 18px; padding: 28px; margin-bottom: 24px; position: relative; overflow: hidden; }
    .pred-dashboard::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--accent, #60a5fa); }
    .pred-hero { display: flex; align-items: center; gap: 28px; flex-wrap: wrap; }
    .pred-score { text-align: center; min-width: 100px; }
    .pred-num { font-size: 3rem; font-weight: 800; color: var(--accent, #60a5fa); line-height: 1; }
    .pred-sub { font-size: 0.78rem; color: #64748b; margin-top: 4px; }
    .pred-meter { width: 100%; height: 6px; background: #1e293b; border-radius: 3px; margin-top: 10px; overflow: hidden; }
    .pred-fill { height: 100%; border-radius: 3px; transition: width 0.6s; }
    .pred-body { flex: 1; min-width: 0; }
    .pred-emoji { font-size: 1.5rem; }
    .pred-label { font-size: 1.05rem; font-weight: 600; color: #f1f5f9; margin-left: 6px; display: inline; }
    .pred-action { color: #94a3b8; margin-top: 8px; font-size: 0.92rem; line-height: 1.5; }
    .pred-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .dim-chip { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 4px 12px; font-size: 0.8rem; color: #94a3b8; }
    .pred-scenarios { margin-top: 24px; padding-top: 20px; border-top: 1px solid #2d3a4e; }
    .sc-title { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1.5px; color: #64748b; margin-bottom: 12px; font-weight: 600; }
    .sc-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .sc-card { background: #131c2e; border: 1px solid #1e293b; border-radius: 10px; padding: 14px 16px; }
    .sc-card.sc-base { border-left: 3px solid #94a3b8; }
    .sc-card.sc-up { border-left: 3px solid #22c55e; }
    .sc-card.sc-down { border-left: 3px solid #ef4444; }
    .sc-icon { font-size: 0.9rem; }
    .sc-name { font-weight: 600; color: #f1f5f9; margin-left: 6px; }
    .sc-pct { display: block; font-size: 1.4rem; font-weight: 800; color: #e2e8f0; margin: 6px 0 4px; }
    .sc-action { font-size: 0.78rem; color: #94a3b8; line-height: 1.4; }
    /* 侧栏 */
    .sidebar { width: 200px; flex-shrink: 0; position: sticky; top: 80px; }
    .sidebar-block { margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid #1e293b; }
    .sb-title { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 1.2px; color: #64748b; margin-bottom: 10px; font-weight: 600; }
    .dim-bar { display: flex; align-items: center; gap: 6px; margin: 6px 0; font-size: 0.75rem; }
    .dim-name { width: 42px; color: #94a3b8; flex-shrink: 0; }
    .dim-bg { flex: 1; height: 5px; background: #1e293b; border-radius: 3px; overflow: hidden; }
    .dim-fill { height: 100%; border-radius: 3px; transition: width 0.5s; }
    .dim-val { width: 22px; text-align: right; color: #64748b; font-weight: 600; }
    .toc { display: flex; flex-direction: column; gap: 4px; }
    .toc a { color: #64748b; text-decoration: none; font-size: 0.75rem; padding: 3px 6px; border-radius: 4px; transition: color 0.15s, background 0.15s; }
    .toc a:hover { color: #e2e8f0; background: #1e293b; }
    /* 内容区 */
    #content { font-size: 0.98rem; }
    #content h2 { font-size: 1.3rem; color: #f1f5f9; margin: 32px 0 14px; padding-bottom: 6px; border-bottom: 1px solid #1e293b; }
    #content h3 { font-size: 1.1rem; color: #e2e8f0; margin: 24px 0 10px; }
    #content p { margin: 12px 0; }
    #content strong { color: #f1f5f9; font-weight: 600; }
    #content a { color: #60a5fa; text-decoration: none; border-bottom: 1px solid #60a5fa33; }
    #content table { width: 100%; border-collapse: collapse; margin: 20px 0; background: #131c2e; border-radius: 10px; overflow: hidden; font-size: 0.9rem; }
    #content th { background: #1a2332; padding: 10px 14px; text-align: left; color: #94a3b8; font-weight: 600; font-size: 0.8rem; text-transform: uppercase; }
    #content td { padding: 10px 14px; border-top: 1px solid #1e293b; }
    #content code { font-family: "JetBrains Mono", "Fira Code", monospace; font-size: 0.85em; background: #1a2332; padding: 2px 8px; border-radius: 4px; }
    #content pre { background: #0f172a; border: 1px solid #1e293b; border-radius: 10px; padding: 16px; margin: 20px 0; overflow-x: auto; }
    #content pre code { background: transparent; padding: 0; font-size: 0.82rem; }
    #content blockquote { border-left: 3px solid #60a5fa; background: #131c2e; padding: 10px 18px; margin: 14px 0; border-radius: 0 8px 8px 0; }
    #content ul, #content ol { margin: 8px 0; padding-left: 22px; }
    #content li { margin: 3px 0; }
    #content hr { border: none; height: 1px; background: #1e293b; margin: 28px 0; }
    .footer-meta { margin-top: 48px; padding-top: 24px; border-top: 1px solid #1e293b; text-align: center; color: #475569; font-size: 0.78rem; }
    @media (max-width: 768px) {
      .article-layout { flex-direction: column; padding: 20px 14px 60px; }
      .sidebar { width: 100%; position: static; display: flex; flex-wrap: wrap; gap: 12px; }
      .sidebar-block { margin-bottom: 0; padding-bottom: 0; border-bottom: none; }
      .sc-grid { grid-template-columns: 1fr; }
      .pred-hero { flex-direction: column; align-items: flex-start; }
    }
  </style>
</head>
<body>
  <nav class="topbar">
    <a href="/"><span class="logo">📊 SnpRush</span></a>
    <span class="report-date">${esc(dateLabel)} 分析报告</span>
    <a href="/">← 返回列表</a>
  </nav>
  <div class="article-layout">
    ${(dims.length > 0 || scoreInfo) ? `<aside class="sidebar">
      ${scoreInfo ? `<div class="sidebar-block"><div class="sb-title">综合评分</div><div style="text-align:center">
        <div style="width:80px;height:80px;border-radius:50%;margin:0 auto 8px;background:conic-gradient(${scoreInfo.score >= 70 ? '#22c55e' : scoreInfo.score >= 40 ? '#f59e0b' : '#ef4444'} ${scoreInfo.score * 3.6}deg, #1e293b ${scoreInfo.score * 3.6}deg);display:flex;align-items:center;justify-content:center">
          <div style="width:60px;height:60px;border-radius:50%;background:#0b1120;display:flex;flex-direction:column;align-items:center;justify-content:center">
            <div style="font-size:1.3rem;font-weight:800;color:#f1f5f9;line-height:1">${scoreInfo.score}</div>
            <div style="font-size:0.6rem;color:#64748b">/100</div>
          </div>
        </div>
      </div></div>` : ''}
      ${dims.length ? `<div class="sidebar-block"><div class="sb-title">四维度</div>${dimBars}</div>` : ''}
    </aside>` : ''}
    <main class="article-main">
      ${dashboardHtml}
      <div id="content"></div>
      <div class="footer-meta">报告由 SnpRush 自动生成 · 仅供研究参考，不构成投资建议</div>
    </main>
  </div>
  <script>const md = \`${esc(mdContent(rawMarkdown))}\`; document.getElementById('content').innerHTML = marked.parse(md);</script>
</body>
</html>`;
}

function mdContent(raw) {
  return raw.replace(/\\/g, '\\\\').replace(/\`/g, '\\`').replace(/\$/g, '\\$');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost`);
  let filePath = path.join(DOCS_DIR, url.pathname === '/' ? '' : url.pathname);

  if (!filePath.startsWith(DOCS_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    fs.readdir(DOCS_DIR, (err, allFiles) => {
      if (err) { res.writeHead(500); return res.end('Server error'); }
      const mdFiles = allFiles.filter(f => f.endsWith('.md')).sort().reverse();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderIndex(mdFiles));
    });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.md') {
    fs.readFile(filePath, 'utf-8', (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not Found'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderArticle(path.basename(filePath), data));
    });
    return;
  }

  const mime = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css',
    '.js': 'application/javascript', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  };
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not Found'); }
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`📊 SnpRush Docs Server running on http://0.0.0.0:${PORT}`);
});
