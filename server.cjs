#!/usr/bin/env node
// SnpRush Docs Server — 展示 docs/ 下的分析报告，带评分可视化、分节折叠

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

function extractScenarios(md) {
  const names = [
    { key: '基准', cls: 'base', icon: '⚖️', color: '#64748b' },
    { key: '上行', cls: 'up', icon: '📈', color: '#22c55e' },
    { key: '下行', cls: 'down', icon: '📉', color: '#ef4444' },
  ];
  const out = [];
  for (const { key, cls, icon, color } of names) {
    const row = md.match(new RegExp(`\\| \\*\\*${key}\\*\\* \\| ([^|]+) \\| ([^|]+) \\| ([^|]+)`));
    if (!row) continue;
    const prob = parseInt(String(row[1]).replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(prob)) continue;
    out.push({ name: key, cls, icon, probability: prob, action: row[3].trim().slice(0, 60), color });
  }
  return out.length === 3 ? out : null;
}

function extractQuickGlance(md) {
  const baseRow = md.match(/\| \*\*基准\*\* \| ([^|]+) \| ([^|]+) \| ([^|]+)/);
  const shortOp = md.match(/操作[：:]\s*([^\n]{3,80})/);
  return {
    baseAction: baseRow ? baseRow[3].trim().slice(0, 60) : '',
    shortAction: shortOp ? shortOp[1].trim().slice(0, 60) : '',
  };
}

function quickAdvice(score, direction) {
  const d = direction || (score >= 58 ? 'bullish' : score <= 42 ? 'bearish' : 'neutral');
  if (d === 'bullish') return { emoji: '📈', label: '偏多', headline: '短期动能偏强', action: '维持仓位；回调至支撑位可小幅加仓', color: '#22c55e', bg: '#22c55e15' };
  if (d === 'bearish') return { emoji: '📉', label: '偏空', headline: '下行风险大于反弹空间', action: '暂不加仓，设好止损；等评分回升再入场', color: '#ef4444', bg: '#ef444415' };
  return { emoji: '➡️', label: '中性', headline: '震荡整理，方向未明', action: '维持现有仓位，按纪律执行，少择时', color: '#f59e0b', bg: '#f59e0b15' };
}

function scoreBadge(score) {
  if (score == null) return '<span class="s-badge muted">—</span>';
  let color, label;
  if (score >= 70) { color = '#22c55e'; label = '偏多'; }
  else if (score >= 40) { color = '#f59e0b'; label = '中性'; }
  else { color = '#ef4444'; label = '偏空'; }
  return `<span class="s-badge" style="background:${color}22;color:${color};border-color:${color}44">${score}<span class="s-label">${label}</span></span>`;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function mdContent(raw) {
  return raw.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

// ===== 首页 =====

function renderIndex(files) {
  const fileInfos = files.map(f => {
    const fp = path.join(DOCS_DIR, f);
    const stats = fs.statSync(fp);
    const raw = fs.readFileSync(fp, 'utf-8');
    const scoreInfo = extractScore(raw);
    const dims = extractDimensionScores(raw);
    const dateLabel = f.replace('snprush-analysis-', '').replace('.md', '');
    return { filename: f, dateLabel, mtime: stats.mtime, sizeKB: (stats.size / 1024).toFixed(1), scoreInfo, dims };
  });

  const latest = fileInfos[0];
  const rest = fileInfos.slice(1);

  const total = fileInfos.length;
  const bullish = fileInfos.filter(i => i.scoreInfo?.direction === 'bullish').length;
  const bearish = fileInfos.filter(i => i.scoreInfo?.direction === 'bearish').length;
  const neutral = total - bullish - bearish;
  const avgScore = total > 0 ? Math.round(fileInfos.reduce((s, i) => s + (i.scoreInfo?.score ?? 50), 0) / total) : '—';

  const heroHtml = latest?.scoreInfo ? `<a href="/${latest.filename}" class="hero-card dir-${latest.scoreInfo.direction || 'neutral'}">
    <div class="hero-badge">最新研判</div>
    <div class="hero-left">${scoreBadge(latest.scoreInfo.score)}</div>
    <div class="hero-body">
      <div class="hero-date">${esc(latest.dateLabel)}</div>
      <div class="hero-dims">${latest.dims.map(d => `<span class="h-dim-tag">${d.name} ${d.score}</span>`).join('')}</div>
    </div>
    <div class="hero-arrow">→</div>
  </a>` : '';

  const cardRows = rest.map(r => `<a href="/${r.filename}" class="report-card dir-${r.scoreInfo?.direction || 'neutral'}">
    <div class="rc-score">${scoreBadge(r.scoreInfo?.score ?? null)}</div>
    <div class="rc-body"><div class="rc-date">${r.dateLabel}</div><div class="rc-meta">${r.sizeKB} KB · ${r.mtime.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</div></div>
  </a>`).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>📊 SnpRush 分析报告</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,"PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif;background:linear-gradient(135deg,#0b1120,#0f172a 50%,#0a0f1a);color:#e2e8f0;min-height:100vh}
  .container{max-width:960px;margin:0 auto;padding:32px 20px 48px}
  header{text-align:center;padding:32px 0 40px;position:relative}
  header::after{content:'';position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:80px;height:2px;background:linear-gradient(90deg,transparent,#3b82f6,transparent)}
  header h1{font-size:2rem;background:linear-gradient(135deg,#60a5fa,#2563eb);-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-weight:800;letter-spacing:1px}
  header .subtitle{color:#64748b;margin-top:10px;font-size:.9rem;letter-spacing:2px}
  .stats{display:flex;justify-content:center;gap:16px;margin:36px 0 28px;flex-wrap:wrap}
  .stat-card{background:linear-gradient(135deg,#1e293b,#1a2332);border:1px solid #2d3a4e;border-radius:14px;padding:16px 24px;text-align:center;min-width:100px;transition:transform .2s}
  .stat-card:hover{transform:translateY(-2px);border-color:#3b82f644}
  .stat-card .num{font-size:1.5rem;font-weight:700}.num.green{color:#22c55e}.num.yellow{color:#f59e0b}.num.red{color:#ef4444}.num.blue{color:#60a5fa}
  .stat-card .label{font-size:.7rem;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:1px}
  .hero-card{display:flex;align-items:center;gap:20px;background:linear-gradient(135deg,#1a2744,#1e293b,#172033);border:1px solid #334155;border-radius:18px;padding:24px 28px;margin-bottom:24px;text-decoration:none;color:inherit;transition:transform .2s,border-color .2s;position:relative;overflow:hidden}
  .hero-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:#f59e0b}
  .hero-card.dir-bullish::before{background:linear-gradient(180deg,#22c55e,#16a34a)}
  .hero-card.dir-bearish::before{background:linear-gradient(180deg,#ef4444,#dc2626)}
  .hero-card:hover{transform:translateY(-3px);border-color:#f59e0b55;box-shadow:0 12px 40px #00000044}
  .hero-badge{position:absolute;top:12px;right:16px;font-size:.65rem;font-weight:700;letter-spacing:1px;color:#fbbf24;background:#f59e0b18;border:1px solid #f59e0b33;padding:3px 10px;border-radius:20px}
  .hero-left{flex-shrink:0}.hero-body{flex:1;min-width:0}.hero-date{font-size:.82rem;color:#64748b;margin-bottom:10px}
  .hero-dims{display:flex;flex-wrap:wrap;gap:6px}.h-dim-tag{display:inline-block;background:#1a2332;border:1px solid #2d3a4e;border-radius:6px;padding:2px 8px;font-size:.7rem;color:#94a3b8}.hero-arrow{font-size:1.4rem;color:#475569;flex-shrink:0}
  .s-badge{display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border-radius:20px;font-weight:700;font-size:1.05rem;border:1px solid;white-space:nowrap}
  .s-badge .s-label{font-size:.65rem;font-weight:500;opacity:.85}.s-badge.muted{background:#47556922;color:#64748b;border-color:#47556944}
  .card-grid{display:flex;flex-direction:column;gap:10px}
  .report-card{display:flex;align-items:flex-start;gap:14px;background:#1e293b;border:1px solid #2d3a4e;border-radius:12px;padding:14px 16px;text-decoration:none;color:inherit;transition:background .15s;border-left:3px solid #475569}
  .report-card.dir-bullish{border-left-color:#22c55e}.report-card.dir-bearish{border-left-color:#ef4444}.report-card.dir-neutral{border-left-color:#f59e0b}
  .report-card:hover{background:#243045}.rc-score{flex-shrink:0}.rc-body{flex:1;min-width:0}
  .rc-date{font-weight:600;color:#e2e8f0;font-size:.95rem}.rc-meta{font-size:.72rem;color:#64748b;margin-top:4px}
  .section-label{font-size:.72rem;text-transform:uppercase;letter-spacing:1.5px;color:#64748b;margin:20px 0 12px;font-weight:600}
  footer{text-align:center;margin-top:48px;padding:24px 0;color:#475569;font-size:.78rem}
  .empty{text-align:center;padding:60px 20px;color:#64748b}.empty .icon{font-size:3rem;margin-bottom:16px}
  @media(max-width:768px){.container{padding:20px 14px}header h1{font-size:1.5rem}.stats{gap:8px}.stat-card{padding:12px 16px;min-width:80px}.hero-card{flex-direction:column;align-items:flex-start;padding:20px}.hero-arrow{display:none}}
</style></head>
<body><div class="container">
<header><h1>📊 SnpRush</h1><p class="subtitle">标普500 & 纳斯达克 · 每日分析报告</p></header>
<div class="stats">
  <div class="stat-card"><div class="num blue">${total}</div><div class="label">报告</div></div>
  ${total>0?`<div class="stat-card"><div class="num green">${bullish}</div><div class="label">偏多</div></div>
  <div class="stat-card"><div class="num yellow">${neutral}</div><div class="label">中性</div></div>
  <div class="stat-card"><div class="num red">${bearish}</div><div class="label">偏空</div></div>
  <div class="stat-card"><div class="num blue">${avgScore}</div><div class="label">均分</div></div>`:''}
</div>
${total>0?`${heroHtml}${rest.length?`<div class="section-label">历史日报</div><div class="card-grid">${cardRows}</div>`:''}`:`<div class="empty"><div class="icon">📭</div><p>暂无分析报告<br>运行 <code>node dist/index.js analysis --md</code> 生成第一份</p></div>`}
<footer><p>报告由 SnpRush 自动生成 · 仅供研究参考，不构成投资建议</p></footer>
</div></body></html>`;
}

// ===== 文章页 =====

function renderArticle(mdFilename, rawMarkdown) {
  const dateLabel = mdFilename.replace('snprush-analysis-', '').replace('.md', '');
  const scoreInfo = extractScore(rawMarkdown);
  const dims = extractDimensionScores(rawMarkdown);
  const advice = scoreInfo ? quickAdvice(scoreInfo.score, scoreInfo.direction) : null;
  const scenarios = extractScenarios(rawMarkdown);
  const glance = extractQuickGlance(rawMarkdown);

  const dashboardHtml = scoreInfo ? `
  <section class="pred-dashboard">
    <div class="pred-hero" style="--pred-color:${advice.color};--pred-bg:${advice.bg}">
      <div class="pred-score-col">
        <div class="pred-score-num">${scoreInfo.score}</div>
        <div class="pred-score-sub">综合分 / 100</div>
        <div class="pred-score-meter"><div class="pred-score-fill" style="width:${scoreInfo.score}%;background:${advice.color}"></div></div>
      </div>
      <div class="pred-verdict-col">
        <div class="pred-emoji">${advice.emoji}</div>
        <h2 class="pred-headline">${esc(advice.headline)}</h2>
        <p class="pred-tag">${advice.label} · ${scoreInfo.direction === 'bullish' ? '短期动能偏强' : scoreInfo.direction === 'bearish' ? '需防回调' : '方向待确认'}</p>
        <div class="pred-action-box">
          <span class="pred-action-label">💡 操作建议</span>
          <p class="pred-action-text">${esc(advice.action)}</p>
        </div>
      </div>
      <div class="pred-meta-col">
        ${dims.map(d => `<div class="pred-pill">${d.name} <strong>${d.score}</strong>/100</div>`).join('')}
      </div>
    </div>
    ${scenarios ? `<div class="pred-scenarios"><div class="pred-section-title">未来 1–2 周怎么走？（三情景概率）</div>
    <div class="sc-grid">${scenarios.map(s => `<div class="sc-card sc-${s.cls}">
      <div class="sc-head"><span>${s.icon} ${esc(s.name)}</span><span class="sc-pct">${s.probability}%</span></div>
      <div class="sc-bar"><div class="sc-fill" style="width:${s.probability}%"></div></div>
      <div class="sc-action">${esc(s.action)}</div>
    </div>`).join('')}</div></div>` : ''}
  </section>` : '';

  const dimBars = dims.map(d => {
    const c = d.score >= 70 ? '#22c55e' : d.score >= 40 ? '#f59e0b' : '#ef4444';
    return `<div class="dim-bar-row"><span class="dim-name">${d.name.slice(0,3)}</span><div class="dim-bar-bg"><div class="dim-bar-fill" style="width:${d.score}%;background:${c}"></div></div><span class="dim-val">${d.score}</span></div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(dateLabel)} — SnpRush 分析报告</title>
<script src="https://cdn.jsdelivr.net/npm/marked@12/marked.min.js"></script>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",-apple-system,sans-serif;background:#0b1120;color:#cbd5e1;line-height:1.8}
  .topbar{position:sticky;top:0;z-index:100;background:rgba(11,17,32,.88);backdrop-filter:blur(16px);border-bottom:1px solid #1e293b;padding:0 24px;height:56px;display:flex;align-items:center;justify-content:space-between}
  .topbar a{color:#94a3b8;text-decoration:none;font-size:.88rem;display:flex;align-items:center;gap:6px;transition:color .2s}
  .topbar a:hover{color:#60a5fa}.topbar .logo{font-weight:700;font-size:1rem;color:#60a5fa}.topbar .report-date{color:#64748b;font-size:.82rem}
  .article-layout{max-width:1100px;margin:0 auto;padding:32px 24px 80px;display:flex;gap:36px;align-items:flex-start}
  /* 侧栏 */
  .sidebar{width:200px;flex-shrink:0;position:sticky;top:80px}
  .sb-block{margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #1e293b}
  .sb-title{font-size:.68rem;text-transform:uppercase;letter-spacing:1.2px;color:#64748b;margin-bottom:10px;font-weight:600}
  .dim-bar-row{display:flex;align-items:center;gap:6px;margin:6px 0;font-size:.75rem}
  .dim-name{width:28px;color:#94a3b8;flex-shrink:0}.dim-bar-bg{flex:1;height:5px;background:#1e293b;border-radius:3px;overflow:hidden}
  .dim-bar-fill{height:100%;border-radius:3px;transition:width .5s}.dim-val{width:22px;text-align:right;color:#64748b;font-weight:600}
  .score-ring{width:80px;height:80px;border-radius:50%;margin:0 auto 8px;display:flex;align-items:center;justify-content:center}
  .score-ring-inner{width:60px;height:60px;border-radius:50%;background:#0b1120;display:flex;flex-direction:column;align-items:center;justify-content:center}
  .score-ring-num{font-size:1.3rem;font-weight:800;color:#f1f5f9;line-height:1}.score-ring-sub{font-size:.6rem;color:#64748b}
  /* 预测仪表盘 */
  .pred-dashboard{margin-bottom:28px}.pred-hero{display:grid;grid-template-columns:120px 1fr auto;gap:24px;align-items:start;background:linear-gradient(135deg,#1a2744,#1e293b);border:1px solid #334155;border-left:4px solid var(--pred-color,#f59e0b);border-radius:16px;padding:24px 28px}
  .pred-score-num{font-size:3rem;font-weight:800;color:#f8fafc;line-height:1}
  .pred-score-sub{font-size:.72rem;color:#64748b;margin-top:4px}
  .pred-score-meter{height:6px;background:#0f172a;border-radius:3px;margin-top:10px;overflow:hidden}
  .pred-score-fill{height:100%;border-radius:3px;transition:width .6s}
  .pred-emoji{font-size:1.5rem;margin-bottom:4px}
  .pred-headline{font-size:1.35rem;color:#f1f5f9;font-weight:700;margin-bottom:6px;line-height:1.35}
  .pred-tag{font-size:.82rem;color:var(--pred-color);font-weight:600;margin-bottom:12px}
  .pred-action-box{background:var(--pred-bg,#1e293b);border:1px solid var(--pred-color,#f59e0b);border-radius:10px;padding:12px 14px}
  .pred-action-label{font-size:.68rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;display:block}
  .pred-action-text{font-size:.95rem;color:#e2e8f0;margin-top:4px;font-weight:500;line-height:1.45}
  .pred-meta-col{display:flex;flex-direction:column;gap:8px;align-items:flex-end}
  .pred-pill{font-size:.72rem;padding:5px 10px;border-radius:20px;background:#0f172a;border:1px solid #334155;color:#94a3b8;white-space:nowrap}
  .pred-pill strong{color:#f1f5f9}
  .pred-scenarios{margin-top:20px;padding-top:18px;border-top:1px solid #2d3a4e}
  .pred-section-title{font-size:.75rem;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;font-weight:600}
  .sc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.sc-card{background:#131c2e;border:1px solid #1e293b;border-radius:12px;padding:14px 16px}
  .sc-card.sc-up{border-top:3px solid #22c55e}.sc-card.sc-down{border-top:3px solid #ef4444}.sc-card.sc-base{border-top:3px solid #64748b}
  .sc-head{display:flex;justify-content:space-between;font-size:.85rem;font-weight:600;color:#e2e8f0;margin-bottom:8px}
  .sc-pct{font-size:1.1rem;color:#fbbf24}.sc-bar{height:5px;background:#0f172a;border-radius:3px;overflow:hidden;margin-bottom:10px}
  .sc-fill{height:100%;background:linear-gradient(90deg,#f59e0b,#fbbf24);border-radius:3px}
  .sc-card.sc-up .sc-fill{background:linear-gradient(90deg,#16a34a,#22c55e)}.sc-card.sc-down .sc-fill{background:linear-gradient(90deg,#dc2626,#ef4444)}
  .sc-action{font-size:.78rem;color:#94a3b8;line-height:1.45}
  /* 折叠工具栏 */
  .collapse-toolbar{display:flex;gap:8px;margin-bottom:16px;justify-content:center;flex-wrap:wrap}
  .collapse-btn{background:#1e293b;border:1px solid #334155;color:#94a3b8;border-radius:8px;padding:6px 12px;font-size:.78rem;cursor:pointer;transition:border-color .2s,color .2s}
  .collapse-btn:hover{border-color:#f59e0b55;color:#e2e8f0}
  /* 分节折叠 */
  .md-section{margin:12px 0 16px;background:#0f172a;border:1px solid #1e293b;border-radius:12px;overflow:hidden;scroll-margin-top:80px}
  .md-section-summary{display:flex;align-items:center;justify-content:space-between;cursor:pointer;list-style:none;user-select:none;padding:12px 14px;background:#131c2e;border-left:3px solid #f59e0b;color:#f1f5f9;font-weight:600;font-size:.98rem}
  .md-section-summary::-webkit-details-marker{display:none}
  .md-section[data-sec-kind="short-strategy"] .md-section-summary,
  .md-section[data-sec-kind="mid-strategy"] .md-section-summary{border-left-color:#22c55e}
  .md-section[data-sec-kind="scenarios"] .md-section-summary{border-left-color:#22c55e}
  .md-section[data-sec-kind="rebuttal"] .md-section-summary,
  .md-section[data-sec-kind="tail-risk"] .md-section-summary{border-left-color:#ef4444}
  .md-sec-hint::after{content:'展开';color:#64748b;font-size:.72rem;font-weight:500}
  .md-section[open] > .md-section-summary .md-sec-hint::after{content:'收起';color:#fbbf24}
  .md-section-body{padding:4px 16px 16px}
  /* 内容区 */
  .article-main{flex:1;min-width:0}
  #content{font-size:1rem}.article-header{text-align:center;padding:16px 0 24px;margin-bottom:24px;border-bottom:1px solid #1e293b}
  .article-header h1{font-size:1.4rem;color:#f1f5f9;font-weight:700}.article-header .meta{margin-top:8px;color:#64748b;font-size:.82rem}
  #content h2{font-size:1.15rem;color:#f1f5f9;margin:20px 0 12px;padding:10px 14px;background:#131c2e;border-radius:10px;border-left:3px solid #f59e0b;scroll-margin-top:80px}
  #content h3{font-size:1.05rem;color:#e2e8f0;margin:18px 0 8px}#content p{margin:10px 0}#content strong{color:#f1f5f9;font-weight:600}
  #content table{width:100%;border-collapse:collapse;margin:16px 0;background:#131c2e;border-radius:10px;overflow:hidden;font-size:.9rem}
  #content th{background:#1a2332;padding:10px 14px;text-align:left;color:#94a3b8;font-weight:600;font-size:.8rem;text-transform:uppercase}#content td{padding:10px 14px;border-top:1px solid #1e293b}
  #content code{font-family:"JetBrains Mono","Fira Code",monospace;font-size:.85em;background:#1a2332;padding:2px 8px;border-radius:4px}#content pre{background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:16px;margin:16px 0;overflow-x:auto}#content pre code{background:transparent;padding:0;font-size:.82rem}
  #content blockquote{border-left:3px solid #60a5fa;background:#131c2e;padding:10px 18px;margin:12px 0;border-radius:0 8px 8px 0}#content ul,#content ol{margin:6px 0;padding-left:22px}#content li{margin:3px 0}
  #content hr{border:none;height:1px;background:#1e293b;margin:28px 0}
  .footer-meta{margin-top:40px;padding-top:20px;border-top:1px solid #1e293b;text-align:center;color:#475569;font-size:.78rem}
  @media(max-width:860px){.pred-hero{grid-template-columns:1fr}.pred-meta-col{flex-direction:row;flex-wrap:wrap;align-items:flex-start}.sc-grid{grid-template-columns:1fr}.article-layout{flex-direction:column;padding:20px 14px 60px}.sidebar{position:static;width:100%;display:flex;gap:24px;flex-wrap:wrap}.sb-block{margin-bottom:0;padding-bottom:0;border-bottom:none}}
</style></head>
<body>
<nav class="topbar">
  <a href="/"><span class="logo">📊 SnpRush</span></a>
  <span class="report-date">${esc(dateLabel)} 分析报告</span>
  <a href="/">← 返回列表</a>
</nav>
<div class="article-layout">
  <aside class="sidebar">
    ${scoreInfo?`<div class="sb-block"><div class="sb-title">综合评分</div><div class="score-ring" style="background:conic-gradient(${scoreInfo.score>=70?'#22c55e':scoreInfo.score>=40?'#f59e0b':'#ef4444'} ${scoreInfo.score*3.6}deg,#1e293b ${scoreInfo.score*3.6}deg)"><div class="score-ring-inner"><div class="score-ring-num">${scoreInfo.score}</div><div class="score-ring-sub">/100</div></div></div></div>`:''}
    <div class="sb-block"><div class="sb-title">四维度</div>${dimBars}</div>
  </aside>
  <main class="article-main">
    ${dashboardHtml}
    <div class="collapse-toolbar">
      <button type="button" class="collapse-btn" id="btn-expand-all">📖 全部展开</button>
      <button type="button" class="collapse-btn" id="btn-collapse-all">📕 全部收起</button>
      <button type="button" class="collapse-btn" id="btn-reset-collapse">🔄 恢复默认</button>
    </div>
    <div id="content"></div>
    <div class="footer-meta">报告由 SnpRush 自动生成 · 仅供研究参考，不构成投资建议</div>
  </main>
</div>
<script>
const md = \`${esc(mdContent(rawMarkdown))}\`;
const contentEl = document.getElementById('content');
contentEl.innerHTML = marked.parse(md);

// === 分节折叠（客户端） ===
const OPEN_KEYS = ['短期策略','中长期策略','情景分析'];
const CLOSE_KEYS = ['强制反驳','尾部风险','长期方向','四维度','裁决摘要','历史相似','评分构成','综合研判'];
function secKind(title){const t=String(title||'');if(t.includes('强制反驳'))return'rebuttal';if(t.includes('情景分析'))return'scenarios';if(t.includes('短期策略'))return'short-strategy';if(t.includes('中长期策略'))return'mid-strategy';if(t.includes('尾部风险'))return'tail-risk';if(t.includes('四维度'))return'dimensions';return'other'}
function shouldOpen(t){return OPEN_KEYS.some(k=>t.includes(k))?!CLOSE_KEYS.some(k=>t.includes(k)):false}

const h2s = contentEl.querySelectorAll('h2');
h2s.forEach((h2,i)=>{
  const title = h2.textContent.trim();
  const kind = secKind(title);
  const open = shouldOpen(title);
  const id = 'sec-'+i;
  h2.setAttribute('id',id);
  // 收集直到下一个 h2 的兄弟节点
  const bodyEls = [];
  let el = h2.nextElementSibling;
  while(el && el.tagName!=='H2'){bodyEls.push(el.cloneNode(true));const n=el.nextElementSibling;el=n}
  // 构建 details
  const d = document.createElement('details');
  d.className='md-section';d.setAttribute('data-sec-kind',kind);d.id=id;
  if(open)d.open=true;
  const sum = document.createElement('summary');
  sum.className='md-section-summary';
  sum.innerHTML='<span class="md-sec-title">'+title+'</span><span class="md-sec-hint" aria-hidden="true"></span>';
  d.appendChild(sum);
  const body = document.createElement('div');
  body.className='md-section-body';
  body.appendChild(h2.cloneNode(true));
  bodyEls.forEach(b=>body.appendChild(b));
  d.appendChild(body);
  // 替换原 h2 + 兄弟
  h2.insertAdjacentElement('beforebegin',d);
  // 删除原 h2 和兄弟（标记删除）
  h2.dataset.removed='1';
  let rm = h2.nextElementSibling;
  while(rm && rm.tagName!=='H2'){rm.dataset.removed='1';rm=rm.nextElementSibling}
});
// 统一删除
document.querySelectorAll('[data-removed="1"]').forEach(e=>e.remove());

// === 工具栏 ===
const KEY='snprush-collapse-pref';
const sections=()=>Array.from(document.querySelectorAll('.md-section'));
function setAll(open){sections().forEach(d=>d.open=open);try{localStorage.setItem(KEY,open?'all-open':'all-closed')}catch(_){}}
function resetDefault(){sections().forEach(d=>{const k=d.getAttribute('data-sec-kind')||'';d.open=['short-strategy','mid-strategy','scenarios'].includes(k)});try{localStorage.removeItem(KEY)}catch(_){}}
document.getElementById('btn-expand-all')?.addEventListener('click',()=>setAll(true));
document.getElementById('btn-collapse-all')?.addEventListener('click',()=>setAll(false));
document.getElementById('btn-reset-collapse')?.addEventListener('click',resetDefault);
try{const p=localStorage.getItem(KEY);if(p==='all-open')setAll(true);else if(p==='all-closed')setAll(false)}catch(_){}
</script>
</body></html>`;
}

// ===== HTTP 服务 =====

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let filePath = path.join(DOCS_DIR, url.pathname === '/' ? '' : url.pathname);

  if (!filePath.startsWith(DOCS_DIR)) { res.writeHead(403); return res.end('Forbidden'); }

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

  const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not Found'); }
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`📊 SnpRush Docs Server running on http://0.0.0.0:${PORT}`);
});
