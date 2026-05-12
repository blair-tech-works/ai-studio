# AI Studio

**Multi-Agent Orchestration for Product Development**

> From idea to shipped feature — coordinated AI agents working in the open.

AI Studio is a desktop-style dev environment where a small team of role-specialized AI agents (PM, Frontend, Backend, QA, EVO) takes a product from a brain dump to a graded PRD, decomposes it into tasks, builds it in isolated git worktrees, reviews itself, and ships — with you watching every step on a live dashboard.

![Live kanban — tasks flowing across agents in real time](docs/images/Screenshot%202026-05-12%20at%208.22.18%E2%80%AFAM.png)

---

## The idea

Building software is collaborative. A PM scopes, devs build, QA gates, EVO refines. AI assistance shouldn't collapse those roles into a single chatbot — it should give each role its own agent, its own context, its own git worktree, and let them talk to each other on the record.

| Role | What they do |
| --- | --- |
| **PM** | Drafts and decomposes PRDs |
| **Frontend Dev** | Builds UI in isolated worktrees |
| **Backend Dev** | Owns APIs, persistence, auth |
| **QA** | Reviews, blocks, gates merges |
| **EVO** | Watches outcomes, recommends process changes |
| **Constitution** | Shared values, read by every agent before acting |

---

## How a feature flows through the studio

### 1. Drafting a PRD with the PM agent

You paste a brain dump. The PM agent grills you on edge cases, scope, acceptance criteria. When coverage is sufficient, you finalize.

![PM agent interview before drafting a PRD](docs/images/Screenshot%202026-05-12%20at%207.10.05%E2%80%AFAM.png)

The conversation gets synthesized into a structured PRD with a coverage grade across eight dimensions (Scope, Acceptance Criteria, User Stories, Edge Cases, etc.):

![Synthesized PRD with auto-graded coverage](docs/images/Screenshot%202026-05-12%20at%207.11.39%E2%80%AFAM.png)

Drafting state auto-saves to localStorage — close the tab, come back later, pick up mid-conversation.

### 2. Multi-agent review

Before tasks are spawned, every relevant agent reviews the PRD. They can approve, block, or ask questions. The PRD only flips to **Active** when everyone signs off (or you manually override).

![Multi-agent PRD review: PM, backend, frontend sign-off](docs/images/Screenshot%202026-05-12%20at%207.26.10%E2%80%AFAM.png)

### 3. Task decomposition

Once approved, the PM agent breaks the PRD into tasks. Each task gets an assigned agent role, status, and lives in its own swim lane.

![PRD decomposed into 13 tasks, agents assigned](docs/images/Screenshot%202026-05-12%20at%207.31.54%E2%80%AFAM.png)

### 4. Live kanban while the agents work

Status flows from `todo` → `in_progress` → `review` → `done`. Every agent commit, message, and review shows up in real time via SSE — no refresh button needed.

![Live task progress with per-task agent message counts](docs/images/Screenshot%202026-05-12%20at%207.52.16%E2%80%AFAM.png)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  DASHBOARD            Next.js · React 19 · Tailwind · SSE       │
├─────────────────────────────────────────────────────────────────┤
│  ORCHESTRATOR         Express · TypeScript · Agent lifecycle    │
├─────────────────────────────────────────────────────────────────┤
│  AGENTS  +  DATA      Claude Code CLI · Postgres · Git worktrees│
└─────────────────────────────────────────────────────────────────┘
```

Each layer is replaceable. The orchestrator is the contract: REST + SSE for the dashboard, Claude CLI (or the SDK) for agent calls, Postgres for state.

| Subsystem | What it does |
| --- | --- |
| **Knowledge Base** | Postgres-backed shared memory (`knowledge_base` table). Agents `curl GET /api/kb/<path>` before working and `curl PUT /api/kb/<path>` when they discover something worth saving. Auto-backed up. |
| **Messages** | Every inter-agent message is captured with sender, recipient, type (`message` / `question` / `review` / `decision`). Filterable in the UI. |
| **EVO** | Meta-agent watching shipped/stalled/rejected work; surfaces recommendations with confidence scores. You accept, defer, or reject. |
| **Real-time** | SSE stream at `/api/events` pushes task and message updates to the dashboard within milliseconds. Heartbeat every 15s; polling fallback every 10s. |
| **Persistence** | Single Docker Postgres container, bind-mounted to `data/pg/`. Container restarts don't wipe state. `pg_dump` snapshots on every orchestrator boot and before `db:down`; last 10 retained in `data/backups/`. |
| **Worktrees** | Each agent works in its own git worktree under `tmp/repos/<project>/.worktrees/<prd>-<agent>` — no merge collisions, no shared mutable state. |

---

## Quick start

### Prerequisites

- macOS (current setup is macOS-specific for the Claude CLI auth path)
- **Node.js 22+**
- **Docker Desktop** — used for local Postgres only
- **`claude` CLI** — install via `npm i -g @anthropic-ai/claude-code` (or follow [Anthropic's instructions](https://docs.claude.com/en/docs/claude-code)). Run `claude` once interactively so it caches OAuth tokens in your keychain.

### Install and run

```bash
git clone https://github.com/blair-tech-works/ai-studio.git
cd ai-studio
npm install

# copy and fill in your env
cp orchestrator/.env.example orchestrator/.env
```

Then **in a normal terminal window** (see [PM agent auth](#pm-agent-auth) for why this matters):

```bash
npm run dev
```

This starts:
1. The Postgres container (auto-launches Docker Desktop if needed; idempotent — safe to re-run when up)
2. The orchestrator on `http://localhost:3001`
3. The dashboard on `http://localhost:3000`

Open `http://localhost:3000` and click **+ New Product** to draft your first PRD.

### PM agent auth

The PRD-drafting PM agent needs to call Anthropic. There are two modes — the orchestrator picks based on env:

| | **Mode A — CLI / OAuth** (default) | **Mode B — SDK / API key** |
| --- | --- | --- |
| Set | (leave `ANTHROPIC_API_KEY` empty) | `ANTHROPIC_API_KEY=sk-ant-...` |
| Cost | Free under your Claude subscription | Pay-per-call against your API balance |
| Caveat | The orchestrator must be started **outside** another Claude Code session — the CLI refuses to spawn nested. Start `npm run dev` from a normal terminal, not from inside `claude`. | Works anywhere, including inside Claude Code. |

If you start the orchestrator from inside another Claude Code session and have neither set, the PM endpoint returns a clear error pointing you at one or the other.

### Common scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Bring up DB + orchestrator + dashboard |
| `npm run dev:orchestrator` | Just the orchestrator (also brings up DB via `predev` hook) |
| `npm run dev:dashboard` | Just the Next.js dashboard |
| `npm run db:up` | Start the Postgres container (auto-launches Docker Desktop) |
| `npm run db:down` | Backup the DB, then stop the container |
| `npm run db:backup` | Snapshot to `data/backups/ai_studio_<timestamp>.sql` |
| `npm run db:restore` | Restore from the most recent backup (or pass a path) |
| `npm run db:logs` | Tail Postgres logs |
| `npm run build` | Production build of orchestrator + dashboard |

### Ports

| Port | Service |
| --- | --- |
| `3000` | Dashboard (Next.js) |
| `3001` | Orchestrator (Express + SSE) |
| `5434` | Postgres (host port; the container internally runs on 5432, mapped out to 5434 to avoid colliding with other local Postgres installs) |

---

## Repository layout

```
ai-studio/
├── orchestrator/            Express API · agent lifecycle · SSE
│   ├── src/api/             REST routes (prds, agents, tasks, messages, kb, evo, events)
│   └── src/db/              Postgres pool + migrations
├── dashboard/               Next.js app · live UI
│   ├── app/                 Pages (prds, prds/new, dashboard, tasks, messages, kb, evo, settings)
│   ├── components/ui/       Button · Badge · Card atoms
│   └── lib/                 API client + hooks (useTasks, useMessages, useSSE)
├── agents/                  Per-role CLAUDE.md system prompts (pm, frontend-dev, backend-dev, qa, evo)
├── docker/                  docker-compose.dev.yml for local Postgres
├── scripts/                 db-up.sh · db-backup.sh · db-restore.sh
├── data/                    pg/ (bind-mounted Postgres data) · backups/   ← gitignored
├── docs/                    Overview deck + screenshots
└── tmp/repos/               Agent worktrees   ← gitignored
```

---

## Design

Linear-inspired dark theme with one accent.

| Token | Hex | Usage |
| --- | --- | --- |
| `canvas` | `#08090C` | Page background |
| `surface` | `#0F1014` | Cards, sidebar |
| `elevated` | `#15171C` | Hover states |
| `border` | `#262A33` | Hairline borders |
| `accent` | `#A3E635` | Primary CTA, focus rings, active nav |
| `text` | `#E6E7EB` | Body text |

Inter (sans) + JetBrains Mono. Lucide icons at 1.5px stroke. 8px corners, 1px hairlines, lime focus rings, no glow soup.

---

## Roadmap

1. **Publish flow** — clone target repo, wire agents, ship the first task.
2. **EVO recommendations** — first end-to-end run of the self-improvement loop.
3. **Agent marketplace** — drop-in new specialist roles via `agents/<name>/CLAUDE.md`.
4. **Cloud-hosted demo** — run AI Studio against any GitHub repo with API key auth.

---

For a guided tour of the architecture and product surface, see [`docs/ai-studio-overview.key`](docs/ai-studio-overview.key) (Keynote) or [`docs/ai-studio-overview.pptx`](docs/ai-studio-overview.pptx) (PowerPoint).
