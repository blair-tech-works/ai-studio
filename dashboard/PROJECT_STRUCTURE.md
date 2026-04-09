# AI Studio Dashboard - Project Structure

## Complete File Listing

### Configuration Files
- **package.json** - Dependencies and scripts (Next.js 15, React 19, Tailwind CSS 3.4)
- **tsconfig.json** - TypeScript strict mode configuration
- **next.config.js** - Next.js config with API rewrite to localhost:3001
- **tailwind.config.js** - Tailwind CSS theme with dark mode colors
- **postcss.config.js** - PostCSS with Tailwind + Autoprefixer
- **.gitignore** - Git ignore patterns
- **.env.example** - Environment variables template
- **README.md** - Comprehensive documentation

### App Directory (Next.js 15 App Router)

#### Root Layout & Global Styles
- **app/layout.tsx** - Root layout with Sidebar and dark theme
- **app/globals.css** - Global Tailwind directives, dark theme colors, custom styles

#### Pages
- **app/page.tsx** - Dashboard home with real-time status overview
- **app/tasks/page.tsx** - Tasks management with create/filter functionality
- **app/messages/page.tsx** - Thread-based messaging interface
- **app/prds/page.tsx** - Product Requirements Documents viewer
- **app/kb/page.tsx** - Knowledge Base with search and categories
- **app/evo/page.tsx** - EVO recommendations with metrics and implementation

### Components (React)

#### Navigation & Layout
- **components/Sidebar.tsx** - Main navigation sidebar with active route indicators

#### Dashboard Components
- **components/StatusOverview.tsx** - Metrics cards (agents, tasks, stream status)
- **components/AgentCard.tsx** - Individual agent status display
- **components/TaskList.tsx** - Reusable task list with status badges and progress

#### UI Components
- **components/AgentBadge.tsx** - Agent status badge
- **components/StatusDot.tsx** - Status indicator dot
- **components/PriorityBadge.tsx** - Priority level badge

### Library Code

#### API Client (`lib/api.ts`)
**Interfaces:**
- Agent, Task, Message, PRD, KBEntry, EvoRecommendation, EvoMetrics, SSEEvent

**Fetch Functions:**
- fetchAgents(), fetchTasks(), fetchMessages()
- fetchPRDs(), fetchKB()
- fetchEvoRecommendations(), fetchEvoMetrics()

**Mutation Functions:**
- createTask(), updateTask()
- sendMessage()
- dismissEvoRecommendation(), implementEvoRecommendation()

**Real-time:**
- connectSSE() - EventSource-based SSE connection

#### Custom Hooks (`lib/hooks.ts`)
- **useAgents()** - Fetch + 10s polling, returns { agents, loading, error }
- **useTasks(filters?)** - Fetch + SSE auto-refresh, returns { tasks, loading, error, refetch }
- **useMessages(filters?)** - Fetch + SSE auto-refresh, returns { messages, loading, error, refetch }
- **useSSE()** - SSE connection, returns { events, connected, error }
- **useEvoRecommendations()** - Fetch + SSE auto-refresh, returns { recommendations, metrics, loading, error, refetch }

## Feature Breakdown

### Dashboard Home (/)
- Real-time status overview (agents, tasks, stream)
- Agent list with status and task tracking
- Recent tasks preview (10 latest)
- Live activity event stream (50 event buffer)

### Tasks (/tasks)
- Create new tasks (title, description, agent assignment)
- Filter by status: all, pending, in_progress, completed, failed
- Task details: title, description, progress bar, agent ID, timestamp
- Real-time updates via SSE

### Messages (/messages)
- Thread selector sidebar
- Thread-based message view
- Send messages to threads
- Sender attribution with timestamps
- Real-time message streaming

### PRDs (/prds)
- Browse all PRDs
- Filter by status: draft, review, approved, archived
- Display: title, author, status, dates
- Hover effects for interactivity

### Knowledge Base (/kb)
- Search across title, category, and tags
- Category sidebar with entry count
- Category filter buttons
- Display: title, category, tags, dates
- Responsive grid layout

### EVO (/evo)
- Metrics cards: total, implemented, success rate, avg time
- Filter by status: all, new, reviewed, implemented, rejected
- Recommendations with: title, description, priority, status, category
- Quick actions: Implement (new), Dismiss (new)
- Priority color coding

## Styling System

### Dark Theme Palette
- Background: #0a0a0f
- Cards: #12121a
- Borders: #1f1f2e

### Status Colors
- Active/Success: #10b981 (green)
- Idle/Info: #6366f1 (blue)
- Error: #ef4444 (red)
- Warning: #f59e0b (yellow)
- Pending: #8b5cf6 (purple)

### CSS Classes
- **.card** - Default card with border and hover effect
- **.badge-{status}** - Color-coded status badges
- **.btn, .btn-primary, .btn-secondary, .btn-danger** - Button styles
- **.status-{status}** - Inline status text colors
- **.spinner, .pulse** - Animation classes

## API Integration Architecture

```
Dashboard (port 3000)
  ↓ /api/* rewrites to
Next.js Rewrite (next.config.js)
  ↓
Orchestrator API (port 3001)
  ├── GET /api/agents
  ├── GET /api/tasks
  ├── POST /api/tasks
  ├── PATCH /api/tasks/:id
  ├── GET /api/messages
  ├── POST /api/messages
  ├── GET /api/prds
  ├── GET /api/kb
  ├── GET /api/evo/recommendations
  ├── POST /api/evo/recommendations/:id/implement
  ├── POST /api/evo/recommendations/:id/dismiss
  ├── GET /api/evo/metrics
  └── GET /api/events (SSE Stream)
```

## Real-time Event Flow

```
EventSource (/api/events)
  ↓ dispatches
SSEEvent (type: string, data: any, timestamp: string)
  ↓ received by
useSSE() hook / connectSSE()
  ↓ triggers
useTasks(), useMessages(), useEvoRecommendations() auto-refetch
  ↓ updates
Component state with fresh data
```

## Performance Characteristics

- **Agent polling**: 10 second interval
- **SSE event buffer**: Last 50 events
- **Task list pagination**: First 10 on dashboard, all on tasks page
- **Message loading**: Last 100 by default
- **Build optimization**: Tailwind CSS purged, next/image optimized

## Development Workflow

1. **Add new page**: Create app/[feature]/page.tsx
2. **Add new hook**: Add to lib/hooks.ts with fetchX() + SSE
3. **Add new component**: Create components/[Name].tsx with 'use client'
4. **Add new API endpoint**: Update lib/api.ts functions
5. **Style new content**: Use Tailwind classes + card/badge/btn classes

## Deployment Notes

- Environment: Node.js 18+
- Port: 3000 (dashboard), 3001 (API)
- Build: `npm run build`
- Start: `npm start`
- Dev: `npm run dev`

## Browser Requirements

- Modern browser with EventSource support (SSE)
- CSS Grid and Flexbox support
- ES2020+ JavaScript support
