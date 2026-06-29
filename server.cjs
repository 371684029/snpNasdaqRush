#!/usr/bin/env node
// SnpRush Docs Server — 标普500 & 纳斯达克 投资研究日报
//
// 设计参考姊妹项目 hongliRush（Hero + 概览 pills + 指数卡 + SVG 迷你走势图 + 分区卡片），
// 但配色遵循美股/欧美习惯「绿涨红跌」（与 hongliRush 的 A 股「红涨绿跌」刻意相反）。
// 首页为仪表盘：实时读取本地 SQLite（应用自身写入）渲染指数行情与最新研判，并列出 docs/ 下的分析报告。

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT || 81; // 端口可配置：PORT=8088 node server.cjs
const DOCS_DIR = path.join(__dirname, 'docs');
const DB_PATH = path.join(__dirname, 'data', 'snprush.db');

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- 数据层：只读 SQLite（缺库/无数据时优雅降级） ----------

/** 读取仪表盘所需数据；任何异常都不影响页面（返回 null 字段） */
function loadDashboardData() {
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch {
    return { available: false };
  }

  let db;
  try {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  } catch {
    return { available: false };
  }

  try {
    const reportCount = db.prepare('SELECT COUNT(*) AS c FROM analysis_reports').get().c;
    const priceCount = db.prepare('SELECT COUNT(*) AS c FROM index_prices').get().c;
    const latestReport = db.prepare(
      'SELECT date, overall_score AS score, direction FROM analysis_reports ORDER BY date DESC, id DESC LIMIT 1',
    ).get();

    // 最近 30 日行情（升序），用于点位/涨跌幅/迷你走势图
    const rows = db.prepare(
      `SELECT date, spx_close, ixic_close, vix, us10y_yield, spx_pe
       FROM index_prices ORDER BY date DESC LIMIT 30`,
    ).all().reverse();

    const latestDate = rows.length ? rows[rows.length - 1].date : (latestReport ? latestReport.date : null);

    const series = (key) => rows.map(r => r[key]).filter(v => v != null);
    const buildIndex = (cfg) => {
      const trend = series(cfg.key);
      if (trend.length === 0) return null;
      const point = trend[trend.length - 1];
      const prev = trend.length >= 2 ? trend[trend.length - 2] : point;
      const changePct = prev ? ((point - prev) / prev) * 100 : 0;
      return { ...cfg, point, changePct, trend, sample: trend.length };
    };

    const indices = [
      buildIndex({ name: '标普500', code: 'SPX', key: 'spx_close', unit: '', digits: 2 }),
      buildIndex({ name: '纳斯达克', code: 'IXIC', key: 'ixic_close', unit: '', digits: 2 }),
      buildIndex({ name: 'VIX 恐慌指数', code: 'VIX', key: 'vix', unit: '', digits: 2 }),
      buildIndex({ name: '10年期美债', code: 'US10Y', key: 'us10y_yield', unit: '%', digits: 2 }),
    ].filter(Boolean);

    db.close();
    return { available: true, reportCount, priceCount, latestReport, latestDate, indices };
  } catch {
    try { db.close(); } catch { /* noop */ }
    return { available: false };
  }
}

// ---------- SVG 迷你走势图（移植自 hongliRush 的 Sparkline 算法） ----------

function sparklineSvg(data, positive, width = 150, height = 46) {
  if (!data || data.length === 0) return '';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stepX = width / (data.length - 1 || 1);
  const pts = data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / span) * (height - 6) - 3;
    return [x, y];
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const color = positive ? 'var(--up)' : 'var(--down)';
  const gid = `spark-${positive ? 'up' : 'down'}-${Math.random().toString(36).slice(2, 7)}`;
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.28" />
      <stop offset="100%" stop-color="${color}" stop-opacity="0" />
    </linearGradient></defs>
    <path d="${area}" fill="url(#${gid})" />
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
  </svg>`;
}

function fmtNum(n, digits = 2) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

const DIR_LABEL = { bullish: '📈 看多', bearish: '📉 看空', neutral: '➡️ 中性' };

// ---------- 样式 ----------

const STYLE = `
  :root {
    /* 美股/欧美习惯：绿涨红跌（与 A 股相反，刻意如此） */
    --up: #2ec27e;
    --down: #ff5d6c;
    --bg: #0a0f1e;
    --surface: #131c2e;
    --surface-2: #1a2433;
    --ink: #e2e8f0;
    --ink-soft: #8a97ad;
    --line: #243045;
    --brand: #60a5fa;
    --brand-deep: #2563eb;
    --gold: #fbbf24;
    --radius: 16px;
    --shadow: 0 1px 2px rgba(0,0,0,0.2), 0 10px 30px rgba(0,0,0,0.25);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Roboto, Helvetica, Arial, sans-serif;
    color: var(--ink);
    -webkit-font-smoothing: antialiased;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh;
    background: var(--bg);
    background-image: radial-gradient(circle at 12% -10%, rgba(37,99,235,0.18), transparent 42%),
      radial-gradient(circle at 95% 0%, rgba(96,165,250,0.12), transparent 38%);
  }
  a { color: var(--brand); text-decoration: none; }
  .up { color: var(--up); } .down { color: var(--down); }
  /* Hero */
  .hero { background: linear-gradient(135deg, #0f1d3a, var(--brand-deep) 70%, #3b82f6); color: #fff; padding: 30px 24px; box-shadow: var(--shadow); }
  .hero__inner { max-width: 1080px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
  .hero__brand { display: flex; align-items: center; gap: 16px; }
  .hero__logo { width: 52px; height: 52px; border-radius: 14px; display: grid; place-items: center; font-size: 26px; background: linear-gradient(160deg, #bfdbfe, var(--brand)); box-shadow: 0 6px 16px rgba(0,0,0,0.3); }
  .hero__title { margin: 0; font-size: 23px; font-weight: 800; letter-spacing: .3px; }
  .hero__title .accent { color: #ffd66b; }
  .hero__sub { margin: 4px 0 0; font-size: 13px; color: rgba(255,255,255,.8); }
  .hero__pills { display: flex; gap: 12px; flex-wrap: wrap; }
  .pill { background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.18); backdrop-filter: blur(6px); border-radius: 14px; padding: 10px 16px; text-align: center; min-width: 110px; }
  .pill__label { display: block; font-size: 12px; color: rgba(255,255,255,.75); }
  .pill__value { display: block; font-size: 20px; font-weight: 800; margin-top: 2px; }
  /* Layout */
  .container { max-width: 1080px; width: 100%; margin: 0 auto; padding: 28px 24px 12px; }
  .section { margin-bottom: 30px; }
  .section__head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 16px; }
  .section__title { position: relative; margin: 0; font-size: 19px; font-weight: 800; padding-left: 13px; }
  .section__title::before { content: ''; position: absolute; left: 0; top: 3px; bottom: 3px; width: 4px; border-radius: 3px; background: linear-gradient(var(--brand), var(--gold)); }
  .section__hint { font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: var(--ink-soft); }
  /* Index cards */
  .index-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
  .index-card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px; box-shadow: var(--shadow); transition: transform .18s ease, box-shadow .18s ease; }
  .index-card:hover { transform: translateY(-3px); box-shadow: 0 14px 34px rgba(0,0,0,.4); }
  .index-card__head { display: flex; justify-content: space-between; align-items: flex-start; }
  .index-card__name { margin: 0; font-size: 16px; font-weight: 700; }
  .index-card__code { font-size: 12px; color: var(--ink-soft); }
  .tag { font-size: 13px; font-weight: 700; padding: 3px 9px; border-radius: 8px; }
  .tag--up { color: var(--up); background: rgba(46,194,126,.12); }
  .tag--down { color: var(--down); background: rgba(255,93,108,.12); }
  .index-card__body { display: flex; align-items: flex-end; justify-content: space-between; margin: 14px 0; gap: 8px; }
  .index-card__point { font-size: 26px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .index-card__foot { display: flex; gap: 24px; border-top: 1px dashed var(--line); padding-top: 12px; }
  .metric__label { display: block; font-size: 12px; color: var(--ink-soft); }
  .metric__value { display: block; font-size: 15px; font-weight: 700; margin-top: 2px; font-variant-numeric: tabular-nums; }
  /* Report list */
  .report-list { display: grid; gap: 12px; }
  .report-card { display: flex; align-items: center; gap: 14px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px 18px; box-shadow: var(--shadow); transition: transform .18s ease, box-shadow .18s ease; }
  .report-card:hover { transform: translateY(-2px); box-shadow: 0 12px 30px rgba(0,0,0,.4); }
  .report-card__icon { font-size: 22px; }
  .report-card__main { flex: 1; min-width: 0; }
  .report-card__name { font-weight: 600; }
  .report-card__name a { color: var(--ink); }
  .report-card__name a:hover { color: var(--brand); }
  .report-card__meta { font-size: 12.5px; color: var(--ink-soft); margin-top: 3px; }
  .report-card__size { font-size: 12.5px; color: var(--ink-soft); white-space: nowrap; }
  .empty { text-align: center; padding: 50px 20px; color: var(--ink-soft); background: var(--surface); border: 1px dashed var(--line); border-radius: var(--radius); }
  .empty .icon { font-size: 2.5rem; margin-bottom: 12px; }
  .footer { text-align: center; padding: 24px 16px 30px; font-size: 12.5px; color: var(--ink-soft); }
  @media (max-width: 760px) { .hero__pills { width: 100%; } .pill { flex: 1; } }
`;

// ---------- 渲染 ----------

function renderIndexCard(idx) {
  const positive = idx.changePct >= 0;
  const cls = positive ? 'up' : 'down';
  return `<article class="index-card">
    <div class="index-card__head">
      <div>
        <h3 class="index-card__name">${esc(idx.name)}</h3>
        <span class="index-card__code">${esc(idx.code)}</span>
      </div>
      <span class="tag tag--${cls}">${positive ? '+' : ''}${idx.changePct.toFixed(2)}%</span>
    </div>
    <div class="index-card__body">
      <div class="index-card__point ${cls}">${fmtNum(idx.point, idx.digits)}${idx.unit}</div>
      ${sparklineSvg(idx.trend, positive)}
    </div>
    <div class="index-card__foot">
      <div class="metric"><span class="metric__label">区间样本</span><span class="metric__value">${idx.sample} 日</span></div>
      <div class="metric"><span class="metric__label">区间高/低</span><span class="metric__value">${fmtNum(Math.max(...idx.trend), idx.digits)} / ${fmtNum(Math.min(...idx.trend), idx.digits)}</span></div>
    </div>
  </article>`;
}

function renderReportCard(f) {
  const stats = fs.statSync(path.join(DOCS_DIR, f));
  const dateStr = stats.mtime.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const sizeKB = (stats.size / 1024).toFixed(1);
  const dateLabel = f.replace('snprush-analysis-', '').replace('.md', '');
  return `<div class="report-card">
    <div class="report-card__icon">📊</div>
    <div class="report-card__main">
      <div class="report-card__name"><a href="/${encodeURIComponent(f)}">${esc(dateLabel)} 分析报告</a></div>
      <div class="report-card__meta">${esc(f)} · ${dateStr}</div>
    </div>
    <div class="report-card__size">${sizeKB} KB</div>
  </div>`;
}

function renderDashboard(files, data) {
  const d = data || { available: false };
  const latest = d.latestReport;

  const pills = [];
  if (latest) {
    pills.push(`<div class="pill"><span class="pill__label">最新研判</span><span class="pill__value">${latest.score ?? '—'} · ${(DIR_LABEL[latest.direction] || latest.direction || '—')}</span></div>`);
  }
  pills.push(`<div class="pill"><span class="pill__label">分析报告</span><span class="pill__value">${d.reportCount ?? files.length}</span></div>`);
  if (d.priceCount != null) {
    pills.push(`<div class="pill"><span class="pill__label">行情数据</span><span class="pill__value">${d.priceCount} 日</span></div>`);
  }

  const subDate = d.latestDate ? `最新数据 ${esc(d.latestDate)}` : '尚无行情数据';

  const indicesSection = (d.indices && d.indices.length > 0)
    ? `<section class="section">
        <div class="section__head"><h2 class="section__title">指数行情</h2><span class="section__hint">Market Snapshot</span></div>
        <div class="index-grid">${d.indices.map(renderIndexCard).join('\n')}</div>
      </section>`
    : `<section class="section">
        <div class="section__head"><h2 class="section__title">指数行情</h2><span class="section__hint">Market Snapshot</span></div>
        <div class="empty"><div class="icon">📭</div><p>暂无行情数据<br>运行 <code>node dist/index.js price</code> 或 <code>analysis</code> 采集后自动展示</p></div>
      </section>`;

  const reportsSection = files.length > 0
    ? `<div class="report-list">${files.map(renderReportCard).join('\n')}</div>`
    : `<div class="empty"><div class="icon">📭</div><p>暂无分析报告<br>运行 <code>node dist/index.js analysis --md</code> 生成第一份</p></div>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>📊 SnpRush · 标普500 & 纳斯达克 投资研究日报</title>
  <style>${STYLE}</style>
</head>
<body>
  <header class="hero">
    <div class="hero__inner">
      <div class="hero__brand">
        <span class="hero__logo">📊</span>
        <div>
          <h1 class="hero__title">snp<span class="accent">Rush</span> · 标普500 &amp; 纳斯达克 投资研究日报</h1>
          <p class="hero__sub">${subDate}</p>
        </div>
      </div>
      <div class="hero__pills">${pills.join('\n')}</div>
    </div>
  </header>
  <main class="container">
    ${indicesSection}
    <section class="section">
      <div class="section__head"><h2 class="section__title">分析报告</h2><span class="section__hint">Analysis Reports</span></div>
      ${reportsSection}
    </section>
  </main>
  <footer class="footer">报告由 SnpRush 自动生成 · 仅供研究参考，不构成投资建议 · 市场有风险，投资需谨慎</footer>
</body>
</html>`;
}

function mdContent(raw) {
  return raw.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

function renderArticle(mdFilename, rawMarkdown) {
  const dateLabel = mdFilename.replace('snprush-analysis-', '').replace('.md', '');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(dateLabel)} — SnpRush 分析报告</title>
  <script src="https://cdn.jsdelivr.net/npm/marked@12/marked.min.js"></script>
  <style>
    ${STYLE}
    .topbar { position: sticky; top: 0; z-index: 100; background: rgba(10,15,30,.85); backdrop-filter: blur(16px); border-bottom: 1px solid var(--line); padding: 0 24px; height: 56px; display: flex; align-items: center; justify-content: space-between; }
    .topbar .logo { font-weight: 700; color: var(--brand); }
    .topbar .sep { color: #334155; font-size: .75rem; margin: 0 8px; }
    .topbar .report-date { color: var(--ink-soft); font-size: .85rem; }
    .article-wrap { max-width: 820px; margin: 0 auto; padding: 36px 32px 80px; }
    .article-header { text-align: center; padding: 28px 0 34px; margin-bottom: 36px; border-bottom: 1px solid var(--line); }
    .article-header .badge { display: inline-block; background: linear-gradient(135deg, rgba(59,130,246,.18), rgba(37,99,235,.18)); border: 1px solid rgba(59,130,246,.25); color: var(--brand); font-size: .75rem; padding: 4px 14px; border-radius: 20px; letter-spacing: 1px; margin-bottom: 14px; }
    .article-header h1 { font-size: 1.7rem; color: #f1f5f9; font-weight: 700; }
    #content { font-size: 1rem; color: #cbd5e1; line-height: 1.8; }
    #content h1 { font-size: 1.5rem; color: #f1f5f9; margin: 32px 0 14px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
    #content h2 { font-size: 1.3rem; color: #f1f5f9; margin: 28px 0 12px; }
    #content h3 { font-size: 1.12rem; color: #e2e8f0; margin: 22px 0 10px; }
    #content strong { color: #f1f5f9; }
    #content table { width: 100%; border-collapse: collapse; margin: 18px 0; background: var(--surface); border-radius: 10px; overflow: hidden; font-size: .92rem; }
    #content th { background: var(--surface-2); padding: 10px 14px; text-align: left; color: var(--ink-soft); font-size: .82rem; text-transform: uppercase; }
    #content td { padding: 10px 14px; border-top: 1px solid var(--line); }
    #content code { font-family: 'JetBrains Mono','Fira Code',Consolas,monospace; font-size: .88em; background: var(--surface-2); padding: 2px 8px; border-radius: 4px; }
    #content pre { background: #0f172a; border: 1px solid var(--line); border-radius: 10px; padding: 16px 18px; overflow-x: auto; }
    #content blockquote { border-left: 3px solid var(--brand); background: var(--surface); padding: 10px 18px; margin: 16px 0; border-radius: 0 8px 8px 0; }
    .footer-meta { margin-top: 44px; padding-top: 22px; border-top: 1px solid var(--line); text-align: center; color: var(--ink-soft); font-size: .8rem; }
  </style>
</head>
<body>
  <nav class="topbar">
    <div><a href="/"><span class="logo">📊 SnpRush</span></a><span class="sep">/</span><span class="report-date">${esc(dateLabel)} 分析报告</span></div>
    <a href="/">← 返回首页</a>
  </nav>
  <div class="article-wrap">
    <div class="article-header">
      <div class="badge">📊 综合分析报告</div>
      <h1>${esc(dateLabel)} 美股投资研究</h1>
    </div>
    <div id="content"></div>
    <div class="footer-meta">报告由 SnpRush 自动生成 · 仅供研究参考，不构成投资建议</div>
  </div>
  <script>const md = \`${esc(mdContent(rawMarkdown))}\`; document.getElementById('content').innerHTML = marked.parse(md);</script>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const decodedPath = decodeURIComponent(url.pathname);
  let filePath = path.join(DOCS_DIR, decodedPath === '/' ? '' : decodedPath);

  if (!filePath.startsWith(DOCS_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    fs.readdir(DOCS_DIR, (err, allFiles) => {
      const mdFiles = err ? [] : allFiles.filter(f => f.endsWith('.md')).sort().reverse();
      const data = loadDashboardData();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderDashboard(mdFiles, data));
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
