# AGENTS.md

## Cursor Cloud specific instructions

SnpRush is a TypeScript CLI (`commander`) that analyzes the S&P 500 / NASDAQ via an LLM
pipeline, stores data in a local SQLite DB (`better-sqlite3`, auto-created at
`data/snprush.db`), and ships a standalone HTML report viewer (`server.cjs`). Standard
commands live in `package.json` (`build`, `dev`, `start`, `lint`) and `README.md`.

Non-obvious caveats for this environment:

- The CLI's core flows (`price`, `analysis`, `etf`, `snapshot`) require an external
  **opencode LLM server** (`OPENCODE_SERVER`, default `http://localhost:8080`, Basic auth via
  `OPENCODE_SERVER_USERNAME`/`OPENCODE_SERVER_PASSWORD`) which is NOT part of this repo and is
  not running in the cloud VM. Without it, data collection fails — `price` degrades gracefully
  (prints a "数据采集失败" notice), `analysis`/`etf` error out. To exercise these, set
  `OPENCODE_SERVER` (e.g. in `.env`) to a reachable opencode server. `TAVILY_API_KEY` is
  optional (DuckDuckGo fallback per README).
- LLM-free commands that run fully offline: `history` (reads SQLite), `calibrate` (reads
  archived reports), and `quant` (pure-local量化评分引擎, zero LLM — needs ≥20 days of
  `index_prices`; also prints a dual-score vs the latest stored LLM report). These auto-create
  `data/snprush.db` on first run.
- The Web dashboard's 量化评分 card reuses the compiled quant engine via dynamic `import()` of
  `dist/`, so it only appears after `npm run build`; without `dist/` the dashboard still renders
  (the quant card is simply omitted). The `quant` CLI command needs the build too (`dist/`).
- Report viewer: `node server.cjs` is a standalone dashboard (Hero + 概览 pills + 指数卡/SVG
  sparkline + 报告列表) that reads `docs/*.md` and **read-only** opens the SQLite at
  `data/snprush.db` (gracefully degrades to a reports-only view if the DB is missing/empty).
  It does NOT depend on the TS build. Port is configurable via `PORT` env (default **81**,
  privileged). On this VM prefer a non-privileged port to avoid sudo, e.g.
  `PORT=8088 node server.cjs`; if you must use 81, run as root with the absolute node path
  (`sudo /exec-daemon/node server.cjs`, since node is not on root's PATH).
- Automated tests use **vitest**: run `npm test` (`vitest run`). Specs live in `test/` (outside
  `tsconfig` `include`, so they don't affect `build`/`lint`).
- Copy `.env.example` to `.env` if you need to point at an opencode server / set a Tavily key.

### Git authorship (user preference, permanent)
- Always author/commit as **`wll <371684029@qq.com>`**. At the start of a session set:
  `git config user.name "wll"` and `git config user.email "371684029@qq.com"` (the cloud VM
  otherwise defaults to a generic agent identity).
