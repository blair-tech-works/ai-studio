# Product Requirements Document: AI Studio

**Version:** 1.0
**Author:** Colby Blair (Human) + Claude (PM Agent)
**Date:** 2026-04-08
**Status:** Approved

---

## 1. Overview

AI Studio is an autonomous multi-agent development platform that orchestrates specialized Claude Code agents to collaboratively build software. Instead of a single Claude Code session trying to do everything, AI Studio decomposes work across purpose-built agents — each with its own identity, scope, knowledge, and git worktree — that communicate through tasks, messages, and pull requests.

The human's role is deliberately minimal: draft PRDs with the PM agent, approve or override PRD consensus, and review pull requests. Everything else — task decomposition, assignment, execution, testing, process improvement — happens autonomously.

### 1.1 Problem Statement

A single Claude Code session suffers from several compounding limitations:

- **Context degradation.** As a session grows, the model loses fidelity. It forgets earlier decisions, starts making inconsistent choices, and performance degrades.
- **No self-review.** Claude Code does its best on the first shot but does not look back at its own work to evaluate for errors, bugs, or better approaches. The human must explicitly ask for that.
- **No role specialization.** Real development teams have front-end engineers, back-end engineers, QA, DevOps, security, product management, and more. A single session can play all those roles, but it won't unless manually prompted to switch hats.
- **No persistent memory.** Each new session starts cold. Lessons learned — deployment gotchas, architectural decisions, debugging breakthroughs — are lost unless the human manually creates documentation and hopes future sessions read it.
- **No guarantee of SOP adherence.** Even if standard operating procedures exist as documentation, there is no mechanism to ensure a session discovers or follows them.

### 1.2 Core Innovation

AI Studio addresses all of these problems through two key mechanisms:

**Embedded knowledge base references.** A code-commenting convention (`// @kb: <path>`) embeds knowledge base article references directly in the codebase. When any agent reads code (which Claude Code does naturally), it discovers these references and fetches the corresponding KB article from PostgreSQL. This means SOPs, best practices, and lessons learned are always discoverable at the exact point where they are relevant — without any agent needing to know they should go look for them.

**Specialized autonomous agents with inter-agent communication.** Each agent has a narrowly defined scope (its "soul" defined in a CLAUDE.md), runs in its own git worktree, and communicates with other agents through a REST API. A PM agent coordinates work, developer agents write code, QA agents test and report defects, and an EVO agent continuously analyzes the team's process and recommends improvements.

---

## 2. Architecture

### 2.1 System Components

AI Studio is a monorepo with four major components:

```
ai-studio/
├── orchestrator/          # Node.js + TypeScript — the brain
│   ├── src/api/           # REST API (Express)
│   ├── src/agents/        # Agent lifecycle manager
│   ├── src/worktree/      # Git worktree manager
│   ├── src/prd/           # PRD approval loop engine
│   ├── src/db/            # PG connection pool + migration runner
│   └── src/types/         # Shared TypeScript types
├── dashboard/             # Next.js + Tailwind — real-time monitoring UI
│   ├── app/               # Pages (dashboard, tasks, messages, PRDs, KB, EVO)
│   ├── components/        # Reusable UI components
│   └── lib/               # API client + React hooks
├── agents/                # Agent soul files + schema
│   ├── pm/CLAUDE.md
│   ├── backend-dev/CLAUDE.md
│   ├── frontend-dev/CLAUDE.md
│   ├── qa/CLAUDE.md
│   ├── evo/CLAUDE.md
│   └── agent-schema.json  # Template for defining new agents
├── db/migrations/         # PostgreSQL schema + seed data
├── docker/                # Docker Compose + Dockerfiles
├── constitution.md        # 6 governance principles for all agents
└── PRD.md                 # This document
```

### 2.2 Orchestrator

The orchestrator is the central nervous system. It is a Node.js + TypeScript Express server running on port 3001 that provides:

**REST API.** Every interaction between agents, and between agents and the dashboard, goes through the API. Endpoints cover agents, tasks, messages, PRDs, knowledge base, and EVO recommendations. An SSE endpoint (`/api/events`) streams real-time events to the dashboard.

**Agent Lifecycle Manager.** Spawns each agent as a `claude` CLI subprocess with `--dangerously-skip-permissions` for autonomous operation. Each agent gets its own git worktree, its own CLAUDE.md copied into the worktree, and environment variables pointing it to the API. The lifecycle manager monitors heartbeats every 30 seconds and auto-restarts crashed agents.

**Git Worktree Manager.** Creates isolated git worktrees at `/tmp/ai-studio/worktrees/<agent-name>` so agents can work in parallel without stepping on each other. Manages branch creation with the naming convention `agent/<agent-name>/<task-id>`.

**PRD Approval Loop Engine.** Orchestrates the consensus-based PRD approval workflow: publish for review → create pending approval records for all active agents → iterate until consensus or human override.

### 2.3 Dashboard

A Next.js full-stack web application on port 3000, proxying API requests to the orchestrator via Next.js rewrites. Dark themed (background #0a0a0f, cards #12121a, accent blue-500). Pages include:

- **Main Dashboard:** Summary stats (active agents, open tasks, messages today, pending EVO recommendations), real-time activity feed of inter-agent messages, and agent status cards with live indicators.
- **Task Board:** Kanban-style view with columns for backlog, todo, in_progress, review, qa, and done. Task cards show external ID, title, priority badge, assigned agent, and branch name.
- **Message Trail:** Full chronological log of all inter-agent communication. Filterable by agent, message type, and date. System messages styled distinctly.
- **PRD Management:** List of PRDs with status badges. Expandable detail view showing full content and an approval grid (per-agent status). Human override button.
- **Knowledge Base:** Searchable list of KB articles by path, tags, and content.
- **EVO Recommendations:** Pending recommendations sorted by priority. Approve/reject buttons. References to constitution principles. Metrics section.

### 2.4 Database

PostgreSQL 16 with 7 tables:

| Table | Purpose |
|---|---|
| `agents` | Registered agent configurations, status, metrics, PID, worktree path |
| `tasks` | Kanban task board with auto-incrementing external IDs (TASK-001) |
| `messages` | Inter-agent communication log with type classification |
| `prds` | Product requirement documents with versioning |
| `prd_approvals` | Per-agent approval records for each PRD |
| `knowledge_base` | KB articles indexed by hierarchical path |
| `evo_recommendations` | Process improvement recommendations from EVO |

All tables with `updated_at` use a trigger for automatic timestamp updates. Key indexes on foreign keys, status fields, and the KB path column. JSONB columns for flexible metadata, agent config, metrics, labels, and tags.

### 2.5 Agent Communication

Agents communicate exclusively through the orchestrator's REST API. Every agent has these endpoints available:

| Action | Method | Endpoint |
|---|---|---|
| Get my tasks | GET | `/api/tasks?assigned_to={id}&status=todo,in_progress` |
| Update a task | PATCH | `/api/tasks/{id}` |
| Send a message | POST | `/api/messages` |
| Read my messages | GET | `/api/messages?to_agent={id}&read=false` |
| Read a KB article | GET | `/api/kb/{path}` |
| Write a KB article | PUT | `/api/kb/{path}` |
| Read a PRD | GET | `/api/prds/{id}` |
| Submit PRD approval | POST | `/api/prds/{id}/approvals` |

Message types are classified as: `message`, `task_update`, `pr_review`, `question`, `approval`, `escalation`, `system`.

---

## 3. Agent System

### 3.1 Agent Architecture

Each agent is a Claude Code CLI process running in its own git worktree. An agent's identity is defined by its CLAUDE.md file (its "soul"), which specifies its role, scope, boundaries, tools, and operating procedures.

Agents are designed to be **configurable and extensible**. The `agent-schema.json` file defines the full schema for adding a new agent type, including required fields (name, display_name, type, scope, not_scope, constitution_focus) and optional fields (tech_stack, tools, skills, communication_norms, success_metrics, constraints).

### 3.2 MVP Agent Roster (5 Agents)

**PM (Project Manager)**
- Mission: Own PRD lifecycle, decompose tasks, coordinate dependencies, track progress.
- Scope: PRD drafting with human, PRD approval loop management, task decomposition and assignment, cross-agent dependency coordination, integration flow management.
- Does NOT: Write code.

**Backend Developer**
- Mission: Build APIs, database logic, integrations with comprehensive testing.
- Scope: API endpoints, database queries/migrations, server-side business logic, background jobs, third-party integrations, unit and integration tests.
- Stack: TypeScript, Node.js, PostgreSQL, Jest.
- Must: Write tests for all code (>80% coverage target), check `// @kb:` references before starting work, update KB when discovering new patterns.

**Frontend Developer**
- Mission: Build accessible, performant UI and pages.
- Scope: UI components, pages, client-side state, styling, accessibility (WCAG 2.1 AA).
- Stack: React, Next.js, Tailwind CSS, component and e2e testing.
- Must: Coordinate with backend-dev on API contracts, write tests, check KB references.

**QA Agent**
- Mission: Develop test plans, execute tests, identify issues, track quality metrics.
- Scope: Functional test plan development from PRD requirements, test execution against agent work, issue reporting via messages and PR comments, quality metrics tracking per agent, automated test creation.
- Does NOT: Fix code — only identifies and reports issues.
- Feeds: Quality data to EVO for process analysis.

**EVO (Process Evolution)**
- Mission: Analyze processes, identify bottlenecks, recommend improvements, measure impact.
- Scope: Periodic review of all project artifacts (messages, completion rates, PR cycles, defect rates), bottleneck identification, process recommendations categorized as process/quality/tooling/communication.
- Can: Auto-implement low-risk improvements (KB article updates, task template adjustments).
- Must: Escalate high-impact recommendations for human review. Reference constitution principles in all recommendations. Track whether implemented recommendations actually improve metrics.

### 3.3 Adding New Agents

To add a new agent type:

1. Create a directory under `/agents/<agent-name>/`.
2. Write a `CLAUDE.md` file following the patterns established by existing agents.
3. Add a seed record to the `agents` table (or use the POST API if agent creation is exposed).
4. The orchestrator will discover and manage the new agent on next restart.

The `agent-schema.json` documents every field available for agent configuration, including scope, not_scope, tech_stack, tools, skills, constitution_focus, api_permissions, branch_prefix, reporting relationships, collaboration patterns, communication norms, success metrics, and constraints.

### 3.4 Future Agents (Post-MVP)

The video described 13 agents total. Beyond the MVP 5, these are planned:

- Analyst
- Architect
- Designer
- Full-stack Developer
- DevOps
- Growth & Marketing
- Security
- Documentation

Each will follow the same pattern: CLAUDE.md soul file, scoped responsibilities, KB access, and inter-agent messaging.

---

## 4. Workflows

### 4.1 PRD Lifecycle

```
Human + PM Agent collaborate on PRD draft
         │
         ▼
    PM publishes PRD for review
    (status: draft → review)
         │
         ▼
    Pending approval records created
    for ALL active agent types
         │
         ▼
    ┌────────────────────────┐
    │  Each agent reviews    │◄──┐
    │  and either:           │   │
    │  • Approves            │   │
    │  • Submits questions   │   │
    └────────────────────────┘   │
         │                       │
         ▼                       │
    Questions routed to PM ──────┘
    PM + agent iterate until
    question resolved
         │
         ▼
    ┌──────────────────────┐
    │ All agents approved? │
    │                      │
    │  YES → PRD approved  │
    │  NO  → Loop continues│
    └──────────────────────┘
         │
         ▼ (OR)
    Human overrides remaining
    questions as non-blocking
    (status: review → approved)
         │
         ▼
    PM decomposes PRD into tasks
    with acceptance criteria
         │
         ▼
    Tasks assigned to agents
    based on scope
         │
         ▼
    Execution begins (autonomous)
```

**Key decisions:**
- True consensus is required unless the human explicitly overrides.
- Human override sets remaining pending/questions approvals to "overridden" and sends a system message telling agents to use their best judgment on unresolved questions.
- The human is the only actor that can break a deadlock.

### 4.2 Task Execution

```
Agent receives task assignment
         │
         ▼
    Read task description +
    acceptance criteria
         │
         ▼
    Check // @kb: references
    in relevant code
         │
         ▼
    Create branch:
    agent/<name>/<task-id>
         │
         ▼
    Implement + write tests
         │
         ▼
    Verify own work (Principle 3):
    run tests, check build
         │
         ▼
    Open PR with description
    Update task: status → review
    Message PM: work ready for review
         │
         ▼
    QA develops + executes test plan
         │
         ├── Issues found → QA messages
         │   dev agent → dev fixes →
         │   loop back to QA
         │
         └── Tests pass →
             Task: status → done
             Agent updates KB if
             new patterns discovered
```

### 4.3 Quality Feedback Loop

QA findings flow back to development agents as learning signals. Development agents must:
- Fix reported issues promptly.
- Update their approach based on recurring feedback.
- Contribute to KB articles to prevent similar issues.
- Track their quality metrics (defect rate, test pass rate) over time.

EVO periodically analyzes these metrics across all agents and recommends process improvements. Low-risk improvements (KB updates, template changes) can be auto-implemented. High-impact changes (workflow modifications, new gates) are escalated to the human.

### 4.4 Knowledge Base Convention

Code comments embed KB references using the format:

```javascript
// @kb: deployment/staging-process
```

When an agent reads code containing this reference, it fetches the article from PostgreSQL via `GET /api/kb/deployment/staging-process` and incorporates the knowledge before proceeding. KB paths follow a hierarchical convention: `<domain>/<category>/<topic>`.

All agents are expected to both consume and contribute to the knowledge base.

---

## 5. Constitution

Six principles govern all agent behavior. The full text lives in `/constitution.md`. Summary:

| # | Principle | Core Idea |
|---|---|---|
| 1 | Execute the PRD | PRD is source of truth. Consensus-based approval loop. Agents execute autonomously after approval. |
| 2 | Stay in Your Lane | Strict scope boundaries. Out-of-scope work gets messaged to the right agent. |
| 3 | Verify Before Reporting | Never say "done" without running tests, checking the build, loading the page. |
| 4 | Learn and Evolve | QA feedback, test failures, and PR comments are learning signals. Update KB. Repeated mistakes unacceptable. |
| 5 | No Cutting Corners | Write tests. Document changes. Follow codebase patterns. No tech debt shortcuts. |
| 6 | Communicate Transparently | Log every significant action via messaging. Others must be able to reconstruct your reasoning from messages alone. |

---

## 6. Technical Decisions

These decisions were made during the planning phase and are binding for this version:

| Decision | Choice | Rationale |
|---|---|---|
| Target project | Generic / any project | Studio is a reusable framework pointed at any codebase |
| Dashboard stack | Next.js + Tailwind | Full-stack with API route proxying and SSE support |
| Agent orchestration | Claude CLI subprocesses + Node.js orchestrator | Most robust: Claude Code handles tool use, file access, retries natively. Node.js manages lifecycle, health, routing. |
| Data layer | PostgreSQL for everything | KB articles in PG, not flat files. Markdown only for temp storage in /tmp/ (garbage-collectable for k8s). |
| Agent-to-DB communication | REST API via orchestrator | Clean separation. Agents use curl to hit the API. No direct PG access. |
| MVP agents | 5 (PM, Backend Dev, Frontend Dev, QA, EVO) | Configurable system — easy to add new agent types via CLAUDE.md + schema. |
| Agent code access | Direct modification in own worktree | Agents create PRs at will. Human gates at the PR level. |
| Git branching | `agent/<name>/<task-id>` | Clear ownership. Agents create branches per task, PRs back to integration branch. |
| Deployment target | Docker Compose for local dev → k8s cluster | Start local, ship to existing k8s when working. |
| Human involvement | PRD collaboration + PR review only | No human intervention during execution. PR labels used as flags when agents are concerned. |
| PRD consensus | True consensus unless human overrides | No timeouts. Human is the only deadlock breaker. |
| PM role | Single agent does both Product + Project | One PM handles PRD planning and ticket/sprint coordination. |
| KB convention | `// @kb: <path>` in code comments | Agents naturally discover SOPs when reading code. Articles stored in PG. |

---

## 7. Deployment

### 7.1 Local Development

```bash
# Start PostgreSQL (runs migrations on first boot)
docker compose -f docker/docker-compose.yml up postgres -d

# Start orchestrator
cd orchestrator && npm install && npm run dev

# Start dashboard
cd dashboard && npm install && npm run dev
```

Or with Docker Compose (full stack):

```bash
docker compose -f docker/docker-compose.yml up -d
```

A development override is available at `docker/docker-compose.dev.yml` with hot reload via volume mounts.

### 7.2 Production (Kubernetes)

The Docker Compose setup is designed as a stepping stone to k8s. Key considerations for the k8s migration:

- PostgreSQL should be a managed service (RDS, Cloud SQL, etc.) rather than a container.
- Agent worktrees use `/tmp/` which is ephemeral — this is by design for k8s pods.
- The orchestrator needs a persistent volume or external storage only for logs (which can alternatively be shipped to a logging service).
- The dashboard is a stateless Next.js app that scales horizontally.
- Agent processes need access to the target repo and the `claude` CLI — this requires a custom container image with Claude Code installed.

### 7.3 Environment Variables

```
DATABASE_URL=postgresql://ai_studio:ai_studio@localhost:5432/ai_studio
PORT=3001
CLAUDE_CLI_PATH=claude
AGENTS_CONFIG_PATH=./agents
TARGET_REPO_PATH=./target-project
LOG_LEVEL=debug
NEXT_PUBLIC_API_URL=http://localhost:3001
```

---

## 8. Success Criteria

The platform is successful when:

1. **Agents execute PRDs autonomously.** After PRD approval, no human input is required until PR review.
2. **Inter-agent communication is coherent.** Messages between agents are clear, actionable, and traceable. The full communication trail tells a coherent story of how work was done.
3. **Quality improves over time.** Defect rates decrease. Test pass rates increase. KB articles grow. EVO recommendations lead to measurable process improvements.
4. **Adding a new agent type takes < 30 minutes.** Create a CLAUDE.md, add a DB record, restart the orchestrator.
5. **The dashboard provides full visibility.** A human can understand the entire state of the project — who's working on what, what messages were exchanged, what's blocked, what EVO recommends — from the dashboard alone.

---

## 9. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Agents drift from PRD requirements | QA agent validates against acceptance criteria. PRD approval loop forces upfront alignment. |
| Runaway agent costs (token usage) | Heartbeat monitoring. Orchestrator can kill and restart agents. Future: token budget per task. |
| Agents step on each other's code | Isolated git worktrees. Branch-per-task. PR-based integration. |
| Knowledge base becomes stale | EVO monitors KB freshness. Agents required to update KB when discovering new patterns. |
| PRD consensus deadlocks | Human override mechanism. No automated timeout — human decides when to break the deadlock. |
| Agent quality varies | QA tracks per-agent defect rates. EVO analyzes trends. Agents required to internalize feedback (Principle 4). |

---

## 10. Open Questions for Future Versions

- **Token budgeting:** Should each task have a token budget? How do we track and enforce it?
- **Agent-to-agent direct communication:** Should agents be able to pair-program (share a worktree temporarily)?
- **Multi-repo support:** Can the studio manage agents across multiple repositories?
- **CI/CD integration:** Should the orchestrator trigger CI pipelines and parse results?
- **Human notification preferences:** Slack/email notifications for PRs, blocked tasks, EVO escalations?
- **Agent performance benchmarking:** Standardized evals to compare agent configurations?
- **Rollback mechanisms:** If an agent's changes break things, can we auto-revert?
