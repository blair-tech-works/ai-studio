# AI Studio Dashboard

A real-time monitoring dashboard for the AI Studio multi-agent platform. Built with Next.js 15, React 19, and Tailwind CSS.

## Features

- **Real-time Agent Monitoring**: Track agent status, tasks completed, and current activity
- **Task Management**: Create, view, and monitor tasks across all agents
- **Live Message Feed**: Real-time communication between agents and tasks
- **PRD Management**: View and track Product Requirements Documents
- **Knowledge Base**: Searchable documentation repository
- **EVO Recommendations**: AI-generated optimization suggestions with implementation tracking
- **Server-Sent Events (SSE)**: Real-time updates via WebSocket-like streaming

## Architecture

### Directory Structure

```
dashboard/
├── app/                          # Next.js app directory
│   ├── page.tsx                 # Dashboard home page
│   ├── layout.tsx               # Root layout with sidebar
│   ├── globals.css              # Global styles and theme
│   ├── tasks/page.tsx           # Tasks page
│   ├── messages/page.tsx        # Messages page
│   ├── prds/page.tsx            # PRDs page
│   ├── kb/page.tsx              # Knowledge Base page
│   └── evo/page.tsx             # EVO recommendations page
├── components/                   # Reusable React components
│   ├── Sidebar.tsx              # Navigation sidebar
│   ├── AgentCard.tsx            # Agent status card
│   ├── TaskList.tsx             # Task list display
│   └── StatusOverview.tsx       # Dashboard metrics
├── lib/
│   ├── api.ts                   # API client with fetch functions
│   └── hooks.ts                 # Custom React hooks
├── package.json                 # Dependencies
├── tsconfig.json                # TypeScript configuration
├── tailwind.config.js           # Tailwind CSS configuration
├── postcss.config.js            # PostCSS configuration
├── next.config.js               # Next.js configuration
└── .env.example                 # Environment variables template
```

## Technology Stack

- **Frontend Framework**: Next.js 15
- **React**: 19
- **Styling**: Tailwind CSS 3.4
- **Language**: TypeScript 5.6
- **API**: Server-Sent Events (SSE) for real-time updates
- **HTTP Routing**: Next.js rewrites for API proxy

## Setup & Installation

### Prerequisites

- Node.js 18+
- npm or yarn

### Install Dependencies

```bash
npm install
# or
yarn install
```

### Environment Configuration

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

The dashboard automatically proxies API requests from `/api/*` to `http://localhost:3001/api/*` via Next.js rewrites.

## Running the Dashboard

### Development Mode

```bash
npm run dev
# or
yarn dev
```

The dashboard will run at `http://localhost:3000`

### Production Build

```bash
npm run build
npm start
```

## API Integration

### API Client (`lib/api.ts`)

Core functions for interacting with the orchestrator API:

**Fetch Functions:**
- `fetchAgents()` - Get all agents
- `fetchTasks(filters?)` - Get tasks with optional filters
- `fetchMessages(filters?)` - Get messages from threads
- `fetchPRDs()` - Get all PRDs
- `fetchKB()` - Get knowledge base entries
- `fetchEvoRecommendations()` - Get EVO recommendations
- `fetchEvoMetrics()` - Get EVO performance metrics

**Mutation Functions:**
- `createTask(title, description, agentId)` - Create a new task
- `updateTask(id, updates)` - Update task status/details
- `sendMessage(threadId, content, senderName)` - Send message
- `implementEvoRecommendation(id)` - Mark recommendation as implemented
- `dismissEvoRecommendation(id)` - Dismiss a recommendation

**Real-time:**
- `connectSSE(onEvent, onError?)` - Connect to SSE /api/events endpoint

### Custom Hooks (`lib/hooks.ts`)

Encapsulate data fetching and real-time updates:

- `useAgents()` - Fetch agents, auto-poll every 10s
- `useTasks(filters?)` - Fetch tasks, auto-refresh on SSE updates
- `useMessages(filters?)` - Fetch messages, auto-refresh on SSE updates
- `useSSE()` - Connect to SSE, track recent events
- `useEvoRecommendations()` - Fetch EVO data with metrics

All hooks handle loading/error states and return refetch functions for manual refresh.

## Styling & Theme

### Dark Theme

- Background: `#0a0a0f`
- Cards: `#12121a`
- Borders: `#1f1f2e`
- Accent: Blue 500 (`#3b82f6`)
- Status Colors:
  - Active: Green (`#10b981`)
  - Idle: Blue (`#6366f1`)
  - Error: Red (`#ef4444`)
  - Warning: Yellow (`#f59e0b`)
  - Pending: Purple (`#8b5cf6`)

### CSS Classes

- `.card` - Default card styling with hover effects
- `.badge-{status}` - Status badges with color coding
- `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger` - Button styles
- `.status-{status}` - Inline status indicators

## Pages Overview

### Dashboard (/)

- Real-time status overview with metrics
- Agent list with status indicators
- Recent tasks preview
- Live activity stream

### Tasks (/tasks)

- Create new tasks
- Filter by status (pending, in_progress, completed, failed)
- Task details with progress tracking
- Agent assignment

### Messages (/messages)

- Thread-based conversation view
- Send messages to specific threads
- Real-time message streaming
- Sender attribution

### PRDs (/prds)

- View all Product Requirements Documents
- Filter by status (draft, review, approved, archived)
- Track author and dates
- Status indicators

### Knowledge Base (/kb)

- Searchable documentation
- Category-based organization
- Tag filtering
- Creation and update timestamps

### EVO (/evo)

- AI-generated recommendations
- Priority levels (high, medium, low)
- Implementation tracking
- Success metrics and analytics
- One-click implementation/dismissal

## Real-time Features

The dashboard connects to the orchestrator's SSE endpoint at `/api/events` and reacts to:

- `task_created` - New task created
- `task_updated` - Task status changed
- `message_received` - New message in thread
- `agent_status_changed` - Agent status update
- `evo_recommendation` - New EVO recommendation

Hooks automatically refetch relevant data on SSE events.

## Type Safety

Full TypeScript support with exported interfaces:

```typescript
export interface Agent { ... }
export interface Task { ... }
export interface Message { ... }
export interface PRD { ... }
export interface KBEntry { ... }
export interface EvoRecommendation { ... }
export interface EvoMetrics { ... }
export interface SSEEvent { ... }
```

## Performance Optimizations

- Agent polling every 10 seconds (configurable)
- Event queue limited to last 50 events
- Automatic SSE reconnection handling
- Lazy component loading with Next.js
- CSS-in-JS optimizations with Tailwind

## Troubleshooting

### SSE Connection Issues

If the stream isn't connecting, verify:
1. Orchestrator API running on `localhost:3001`
2. `/api/events` endpoint responding with SSE
3. Check browser console for connection errors

### API Errors

The Next.js rewrite forwards `/api/*` to `localhost:3001/api/*`. Ensure:
1. Dashboard runs on port 3000
2. Orchestrator runs on port 3001
3. CORS is properly configured on orchestrator (if needed)

### Styling Issues

Ensure Tailwind CSS is properly compiled:
```bash
npm run build
```

## Development

### Adding New Pages

1. Create `app/[page]/page.tsx`
2. Use custom hooks from `lib/hooks.ts`
3. Import components from `components/`
4. Add sidebar navigation in `Sidebar.tsx`

### Adding New Components

1. Create `components/[Name].tsx`
2. Mark as `'use client'` for interactivity
3. Use TypeScript interfaces for props
4. Apply Tailwind classes for styling

### API Modifications

Update `lib/api.ts` to add new endpoints, then create corresponding hooks in `lib/hooks.ts`.

## License

Proprietary - AI Studio
