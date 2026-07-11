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

  const rows = reports.map(r => {
    const score = r.scoreInfo?.score;
    const dir = r.scoreInfo?.direction;
    const scoreHtml = score != null
      ? `<div class="score-cell">${scoreBar(score)} <span class="score-num">${score}</span></div>`
      : '<span class="score-na">—</span>';
    const dirEmoji = dir === 'bullish' ? '📈' : dir === 'bearish' ? '📉' : '➡️';
    return `<tr>
      <td class="file-icon">📊</td>
      <td class="file-name"><a href="/${r.filename}">${esc(r.dateLabel)} 分析报告</a></td>
      <td class="file-score">${scoreHtml}</td>
      <td class="file-dir">${score != null ? dirEmoji : ''}</td>
      <td class="file-size">${r.sizeKB} KB</td>
      <td class="file-time">${r.dateStr}</td>
    </tr>`;
  }).join('\n');

  // 最新报告的速览信息
  const latest = reports[0];
  let quickGlanceHtml = '';
  if (latest?.scoreInfo) {
    const adv = quickAdvice(latest.scoreInfo.score, latest.scoreInfo.direction);
    const dimTags = latest.dims.map(d =>
      `<span class="dim-tag">${d.name} ${d.score}</span>`
    ).join('');
    quickGlanceHtml = `<div class="quick-glance" style="--accent:${adv.color}">
      <div class="glance-hero">
        <div class="glance-score">
          <span class="glance-num">${latest.scoreInfo.score}</span>
          <span class="glance-sub">/100</span>
        </div>
        <div class="glance-verdict">
          <span class="glance-emoji">${adv.emoji}</span>
          <span class="glance-label">${adv.label}</span>
          <p class="glance-action">${adv.action}</p>
        </div>
      </div>
      <div class="glance-dims">${dimTags}</div>
      <p class="glance-date">📅 ${latest.dateLabel} 最新分析</p>
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>📊 SnpRush 分析报告</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif;
      background: linear-gradient(135deg, #0a0f1e 0%, #0f1923 50%, #0a0e18 100%);
      color: #e2e8f0;
      min-height: 100vh;
    }
    .container { max-width: 960px; margin: 0 auto; padding: 40px 24px; }
    header { text-align: center; padding: 32px 0 40px; position: relative; }
    header::after { content: ''; position: absolute; bottom: 0; left: 50%; transform: translateX(-50%); width: 80px; height: 2px; background: linear-gradient(90deg, transparent, #3b82f6, transparent); }
    header h1 { font-size: 2rem; background: linear-gradient(135deg, #60a5fa, #2563eb); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: 800; letter-spacing: 1px; }
    header .subtitle { color: #64748b; margin-top: 10px; font-size: 0.9rem; letter-spacing: 2px; }
    .quick-glance { background: linear-gradient(135deg, #1a2332, #111827); border: 1px solid #2d3a4e; border-radius: 16px; padding: 24px 28px; margin: 0 0 36px; border-left: 4px solid var(--accent, #3b82f6); }
    .glance-hero { display: flex; align-items: center; gap: 24px; }
    .glance-score { text-align: center; min-width: 80px; }
    .glance-num { font-size: 2.8rem; font-weight: 800; color: var(--accent, #60a5fa); line-height: 1; }
    .glance-sub { font-size: 0.85rem; color: #64748b; display: block; }
    .glance-verdict { flex: 1; }
    .glance-emoji { font-size: 1.6rem; }
    .glance-label { font-size: 1rem; font-weight: 600; color: #f1f5f9; margin-left: 8px; }
    .glance-action { color: #94a3b8; margin-top: 6px; font-size: 0.9rem; line-height: 1.5; }
    .glance-dims { margin-top: 16px; display: flex; flex-wrap: wrap; gap: 8px; }
    .dim-tag { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 4px 12px; font-size: 0.8rem; color: #94a3b8; }
    .glance-date { margin-top: 12px; font-size: 0.78rem; color: #475569; }
    .stats { display: flex; justify-content: center; gap: 24px; margin: 36px 0 32px; flex-wrap: wrap; }
    .stat-card { background: linear-gradient(135deg, #1e293b, #1a2332); border: 1px solid #2d3a4e; border-radius: 14px; padding: 18px 30px; text-align: center; min-width: 130px; transition: transform 0.2s, border-color 0.2s; }
    .stat-card:hover { transform: translateY(-2px); border-color: #3b82f644; }
    .stat-card .num { font-size: 1.6rem; font-weight: 700; color: #60a5fa; }
    .stat-card .label { font-size: 0.75rem; color: #64748b; margin-top: 4px; text-transform: uppercase; letter-spacing: 1px; }
    .table-wrap { background: #1e293b; border: 1px solid #2d3a4e; border-radius: 14px; overflow: hidden; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #1a2332; text-align: left; padding: 14px 16px; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px; color: #64748b; font-weight: 600; }
    td { padding: 14px 16px; border-top: 1px solid #2d3a4e; }
    tr:hover td { background: #243045; }
    td.file-icon { width: 24px; font-size: 1rem; padding-right: 0; }
    td.file-name { min-width: 200px; }
    td.file-name a { color: #e2e8f0; font-weight: 500; text-decoration: none; display: block; line-height: 1.4; }
    td.file-name a:hover { color: #60a5fa; }
    td.file-score { min-width: 130px; }
    .score-cell { display: flex; align-items: center; gap: 8px; }
    .score-num { font-weight: 700; font-size: 0.95rem; }
    .score-na { color: #475569; font-size: 0.85rem; }
    td.file-dir { width: 30px; text-align: center; font-size: 1.1rem; }
    td.file-size, td.file-time { color: #94a3b8; font-size: 0.85rem; white-space: nowrap; }
    footer { text-align: center; margin-top: 48px; padding: 24px 0; color: #475569; font-size: 0.78rem; }
    .empty { text-align: center; padding: 60px 20px; color: #64748b; }
    .empty .icon { font-size: 3rem; margin-bottom: 16px; }
    @media (max-width: 768px) {
      .container { padding: 24px 16px; }
      header h1 { font-size: 1.5rem; }
      .glance-hero { flex-direction: column; align-items: flex-start; }
      .stats { gap: 12px; }
      .stat-card { padding: 14px 20px; min-width: 100px; }
      td.file-size, th:nth-child(5) { display: none; }
      td.file-time, th:nth-child(6) { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>📊 SnpRush</h1>
      <p class="subtitle">标普500 & 纳斯达克 · 每日分析报告</p>
    </header>
    ${quickGlanceHtml}
    <div class="stats">
      <div class="stat-card"><div class="num">${files.length}</div><div class="label">报告总数</div></div>
      ${files.length > 0 ? `<div class="stat-card"><div class="num">${(reports.reduce((s, r) => s + parseFloat(r.sizeKB), 0)).toFixed(0)}</div><div class="label">总大小 (KB)</div></div>
      <div class="stat-card"><div class="num">${latest.dateLabel}</div><div class="label">最新报告</div></div>` : ''}
    </div>
    ${files.length > 0 ? `<div class="table-wrap"><table><thead><tr><th></th><th>报告日期</th><th>综合评分</th><th>方向</th><th>大小</th><th>生成时间</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty"><div class="icon">📭</div><p>暂无分析报告<br>运行 <code>node dist/index.js analysis --md</code> 生成第一份</p></div>`}
    <footer><p>报告由 SnpRush 自动生成 · 仅供研究参考，不构成投资建议</p></footer>
  </div>
</body>
</html>`;
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
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", -apple-system, sans-serif; background: #0a0f1e; color: #cbd5e1; line-height: 1.8; }
    .topbar { position: sticky; top: 0; z-index: 100; background: rgba(10, 15, 30, 0.85); backdrop-filter: blur(16px); border-bottom: 1px solid #1e293b; padding: 0 24px; height: 56px; display: flex; align-items: center; justify-content: space-between; }
    .topbar-left { display: flex; align-items: center; gap: 12px; }
    .topbar a { color: #94a3b8; text-decoration: none; font-size: 0.88rem; display: flex; align-items: center; gap: 6px; transition: color 0.2s; }
    .topbar a:hover { color: #60a5fa; }
    .topbar .logo { font-weight: 700; font-size: 1rem; color: #60a5fa; }
    .topbar .sep { color: #334155; font-size: 0.75rem; }
    .topbar .report-date { color: #64748b; font-size: 0.82rem; }
    .article-wrap { max-width: 820px; margin: 0 auto; padding: 40px 32px 80px; }
    .article-header { text-align: center; padding: 32px 0 40px; margin-bottom: 40px; border-bottom: 1px solid #1e293b; }
    .article-header .badge { display: inline-block; background: linear-gradient(135deg, #3b82f622, #2563eb22); border: 1px solid #3b82f633; color: #60a5fa; font-size: 0.75rem; padding: 4px 14px; border-radius: 20px; letter-spacing: 1px; margin-bottom: 16px; }
    .article-header h1 { font-size: 1.8rem; color: #f1f5f9; font-weight: 700; letter-spacing: 1px; }
    .article-header .meta { margin-top: 12px; color: #64748b; font-size: 0.85rem; }
    #content { font-size: 1rem; color: #cbd5e1; }
    #content h1 { font-size: 1.6rem; color: #f1f5f9; margin: 36px 0 16px; padding-bottom: 8px; border-bottom: 1px solid #1e293b; }
    #content h2 { font-size: 1.35rem; color: #f1f5f9; margin: 32px 0 14px; }
    #content h3 { font-size: 1.15rem; color: #e2e8f0; margin: 24px 0 10px; }
    #content p { margin: 12px 0; }
    #content strong { color: #f1f5f9; font-weight: 600; }
    #content a { color: #60a5fa; text-decoration: none; border-bottom: 1px solid #60a5fa33; }
    #content table { width: 100%; border-collapse: collapse; margin: 20px 0; background: #131c2e; border-radius: 10px; overflow: hidden; font-size: 0.92rem; }
    #content th { background: #1a2332; padding: 10px 14px; text-align: left; color: #94a3b8; font-weight: 600; font-size: 0.82rem; text-transform: uppercase; }
    #content td { padding: 10px 14px; border-top: 1px solid #1e293b; }
    #content code { font-family: "JetBrains Mono", "Fira Code", "Consolas", monospace; font-size: 0.88em; background: #1a2332; padding: 2px 8px; border-radius: 4px; color: #e2e8f0; }
    #content pre { background: #0f172a; border: 1px solid #1e293b; border-radius: 10px; padding: 18px 20px; margin: 20px 0; overflow-x: auto; }
    #content pre code { background: transparent; padding: 0; font-size: 0.85rem; }
    #content blockquote { border-left: 3px solid #60a5fa; background: #131c2e; padding: 12px 20px; margin: 16px 0; border-radius: 0 8px 8px 0; }
    #content ul, #content ol { margin: 8px 0; padding-left: 24px; }
    #content li { margin: 4px 0; }
    #content hr { border: none; height: 1px; background: #1e293b; margin: 32px 0; }
    .footer-meta { margin-top: 48px; padding-top: 24px; border-top: 1px solid #1e293b; text-align: center; color: #475569; font-size: 0.8rem; }
    @media (max-width: 768px) { .article-wrap { padding: 24px 16px 60px; } .article-header h1 { font-size: 1.35rem; } }
  </style>
</head>
<body>
  <nav class="topbar">
    <div class="topbar-left">
      <a href="/"><span class="logo">📊 SnpRush</span></a>
      <span class="sep">/</span>
      <span class="report-date">${esc(dateLabel)} 分析报告</span>
    </div>
    <a href="/">← 返回列表</a>
  </nav>
  <div class="article-wrap">
    <div class="article-header">
      <div class="badge">📊 综合分析报告</div>
      <h1>${esc(dateLabel)} 美股投资研究</h1>
      <div class="meta">${esc(mdFilename)}</div>
    </div>
    <div id="content"></div>
    <div class="footer-meta">报告由 SnpRush 自动生成 · 仅供研究参考，不构成投资建议</div>
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
