# AGENTS.md

## Cursor Cloud specific instructions

SnpRush is a TypeScript CLI (`commander`) that analyzes the S&P 500 / NASDAQ via an LLM
pipeline, stores data in a local SQLite DB (`better-sqlite3`, auto-created at
`data/snprush.db`), and ships a standalone HTML report viewer (`server.cjs`). Standard
commands live in `package.json` (`build`, `dev`, `start`, `lint`) and `README.md`.

Non-obvious caveats for this environment:

- Known build/run blocker: `src/agents/data-collector.ts` imports `../data/search-router.js`,
  but the entire `src/data/` directory (`search-router.ts`, `tavily-client.ts`) is missing
  from the repo and was never committed. As a result `npm run build` and `npm run lint`
  (`tsc`/`tsc --noEmit`) FAIL, and every CLI command fails too — `src/index.ts` statically
  imports `price.ts` → `data-collector.ts` → the missing module, so the whole CLI import
  graph breaks (not just `analysis`). This is a pre-existing code gap, not an env issue.
- The CLI's core flows (`price`, `analysis`, `etf`, `snapshot`) additionally require an
  external **opencode LLM server** (`OPENCODE_SERVER`, default `http://localhost:8080`, Basic
  auth via `OPENCODE_SERVER_USERNAME`/`OPENCODE_SERVER_PASSWORD`) which is not part of this
  repo. Without it, even the data-only path cannot collect data. `TAVILY_API_KEY` is optional
  (DuckDuckGo fallback per README).
- Report viewer: `node server.cjs` serves `docs/*.md` on hardcoded **port 81** (privileged).
  In this VM, run it as root with the absolute node path, e.g. `sudo /exec-daemon/node server.cjs`
  (plain `sudo node ...` fails: node is not on root's PATH). It does NOT depend on the broken
  TS build, so it runs even while the CLI is broken. Open http://localhost:81/ to browse the
  committed report under `docs/`.
- There are no automated tests in this repo (no test script / no test files).
- Copy `.env.example` to `.env` if you need to point at an opencode server / set a Tavily key.
