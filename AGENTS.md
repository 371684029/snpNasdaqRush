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
- LLM-free commands that run fully offline: `history` (reads SQLite), and `calibrate` (reads
  archived reports). These auto-create `data/snprush.db` on first run.
- Report viewer: `node server.cjs` serves `docs/*.md` on hardcoded **port 81** (privileged).
  In this VM, run it as root with the absolute node path, e.g. `sudo /exec-daemon/node server.cjs`
  (plain `sudo node ...` fails: node is not on root's PATH). It does NOT depend on the broken
  TS build, so it runs even while the CLI is broken. Open http://localhost:81/ to browse the
  committed report under `docs/`.
- There are no automated tests in this repo (no test script / no test files).
- Copy `.env.example` to `.env` if you need to point at an opencode server / set a Tavily key.
