const API_BASE_URL = '';

export interface Agent {
  id: string;
  name: string;
  status: 'idle' | 'active' | 'error' | 'stopped';
  role?: string;
  metrics?: Record<string, any>;
  updated_at?: string;
  created_at?: string;
  // Optional fields that may be returned by extended endpoints
  display_name?: string;
  type?: string;
  config?: Record<string, any>;
  pid?: number;
  worktree_path?: string;
  last_heartbeat?: string;
  connected?: boolean;
}

export interface Task {
  id: string;
  external_id: string;
  title: string;
  description?: string;
  status: 'backlog' | 'todo' | 'in_progress' | 'review' | 'qa' | 'done' | 'blocked';
  priority: 'critical' | 'high' | 'medium' | 'low';
  assigned_to?: string; // UUID from DB
  created_by?: string; // UUID from DB
  prd_id?: string;
  branch_name?: string;
  pr_url?: string;
  labels?: string[];
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  from_agent?: string; // UUID from DB (agents.id)
  to_agent?: string; // UUID from DB (agents.id)
  task_id?: string;
  type: 'message' | 'task_update' | 'pr_review' | 'question' | 'approval' | 'escalation' | 'system';
  content: string;
  metadata?: Record<string, any>;
  read: boolean;
  created_at: string;
}

export interface PRD {
  id: string;
  title: string;
  content: string;
  version: number;
  status: 'draft' | 'review' | 'approved' | 'active' | 'completed';
  created_by?: string;
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
  approvals?: PRDApproval[];
}

export interface PRDApproval {
  id: string;
  prd_id: string;
  agent_id: string;
  status: 'pending' | 'approved' | 'questions' | 'overridden';
  comments?: string;
  created_at: string;
  updated_at: string;
}

export interface KBArticle {
  id: string;
  path: string;
  title: string;
  content?: string;
  tags: string[];
  created_by?: string;
  updated_by?: string;
  created_at: string;
  updated_at: string;
}

export interface EvoRecommendation {
  id: string;
  title: string;
  description: string;
  category: string;
  status: 'pending' | 'approved' | 'rejected' | 'implemented';
  priority: 'critical' | 'high' | 'medium' | 'low';
  principles_referenced?: string[];
  created_at: string;
  updated_at: string;
}

export interface EvoMetrics {
  message_counts: Array<{ name: string; message_count: number }>;
  task_completion: Array<{ name: string; completed_tasks: number; total_tasks: number; completion_rate: number }>;
  cycle_time: Array<{ name: string; avg_cycle_time_hours: number }>;
  defect_rates: Array<{ name: string; defect_count: number; total_tasks: number; defect_rate: number }>;
  timestamp: string;
}

export interface SSEEvent {
  type: 'task_created' | 'task_updated' | 'message_received' | 'agent_status_changed' | 'evo_recommendation' | 'connected' | 'heartbeat';
  data: any;
  timestamp: string;
}

// PRD Drafting types
export interface DraftingMessage {
  role: 'human' | 'pm';
  content: string;
}

export interface PRDGradeCategory {
  name: string;
  status: 'covered' | 'partially_covered' | 'missing';
  notes: string;
}

export interface PRDGrade {
  overallScore: number;
  categories: PRDGradeCategory[];
  summary: string;
}

// Core API fetch functions
export async function fetchAgents(): Promise<Agent[]> {
  const res = await fetch('/api/agents');
  if (!res.ok) throw new Error('Failed to fetch agents');
  return res.json();
}

export async function fetchTasks(filters?: { status?: string; assigned_to?: string; priority?: string; limit?: number; offset?: number }): Promise<Task[]> {
  const query = new URLSearchParams();
  if (filters?.status) query.append('status', filters.status);
  if (filters?.assigned_to) query.append('assigned_to', filters.assigned_to);
  if (filters?.priority) query.append('priority', filters.priority);
  if (filters?.limit) query.append('limit', filters.limit.toString());
  if (filters?.offset) query.append('offset', filters.offset.toString());

  const res = await fetch(`/api/tasks${query.toString() ? '?' + query.toString() : ''}`);
  if (!res.ok) throw new Error('Failed to fetch tasks');
  return res.json();
}

export async function fetchMessages(filters?: { from_agent?: string; to_agent?: string; task_id?: string; type?: string; read?: boolean; since?: string; limit?: number; offset?: number }): Promise<Message[]> {
  const query = new URLSearchParams();
  if (filters?.from_agent) query.append('from_agent', filters.from_agent);
  if (filters?.to_agent) query.append('to_agent', filters.to_agent);
  if (filters?.task_id) query.append('task_id', filters.task_id);
  if (filters?.type) query.append('type', filters.type);
  if (filters?.read !== undefined) query.append('read', filters.read.toString());
  if (filters?.since) query.append('since', filters.since);
  if (filters?.limit) query.append('limit', filters.limit.toString());
  if (filters?.offset) query.append('offset', filters.offset.toString());

  const res = await fetch(`/api/messages${query.toString() ? '?' + query.toString() : ''}`);
  if (!res.ok) throw new Error('Failed to fetch messages');
  return res.json();
}

export async function fetchPRDs(filters?: { status?: string }): Promise<PRD[]> {
  const query = new URLSearchParams();
  if (filters?.status) query.append('status', filters.status);

  const res = await fetch(`/api/prds${query.toString() ? '?' + query.toString() : ''}`);
  if (!res.ok) throw new Error('Failed to fetch PRDs');
  return res.json();
}

export async function fetchPRDById(id: string): Promise<PRD> {
  const res = await fetch(`/api/prds/${id}`);
  if (!res.ok) throw new Error('Failed to fetch PRD');
  return res.json();
}

export async function fetchPRDApprovals(prdId: string): Promise<PRDApproval[]> {
  const res = await fetch(`/api/prds/${prdId}/approvals`);
  if (!res.ok) throw new Error('Failed to fetch PRD approvals');
  return res.json();
}

export async function fetchKB(filters?: { tags?: string; search?: string }): Promise<KBArticle[]> {
  const query = new URLSearchParams();
  if (filters?.tags) query.append('tags', filters.tags);
  if (filters?.search) query.append('search', filters.search);

  const res = await fetch(`/api/kb${query.toString() ? '?' + query.toString() : ''}`);
  if (!res.ok) throw new Error('Failed to fetch knowledge base');
  return res.json();
}

export async function fetchEvoRecommendations(filters?: { status?: string; category?: string }): Promise<EvoRecommendation[]> {
  const query = new URLSearchParams();
  if (filters?.status) query.append('status', filters.status);
  if (filters?.category) query.append('category', filters.category);

  const res = await fetch(`/api/evo/recommendations${query.toString() ? '?' + query.toString() : ''}`);
  if (!res.ok) throw new Error('Failed to fetch EVO recommendations');
  return res.json();
}

export async function fetchEvoMetrics(): Promise<EvoMetrics> {
  const res = await fetch('/api/evo/metrics');
  if (!res.ok) throw new Error('Failed to fetch EVO metrics');
  return res.json();
}

// Mutation functions
export async function createTask(data: { title: string; description?: string; assigned_to?: string; priority?: string; prd_id?: string }): Promise<Task> {
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Failed to create task');
  return res.json();
}

export async function updateTask(id: string, updates: Partial<Task>): Promise<Task> {
  const res = await fetch(`/api/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
  if (!res.ok) throw new Error('Failed to update task');
  return res.json();
}

export async function sendMessage(data: { from_agent: string; to_agent: string; content: string; type?: string; task_id?: string; metadata?: Record<string, any> }): Promise<Message> {
  // API expects agent names (will be converted to IDs server-side)
  const res = await fetch('/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Failed to send message');
  return res.json();
}

export async function updateMessage(id: string, data: { read: boolean }): Promise<Message> {
  const res = await fetch(`/api/messages/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Failed to update message');
  return res.json();
}

export async function startAgent(name: string): Promise<Agent> {
  const res = await fetch(`/api/agents/${name}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error('Failed to start agent');
  const data = await res.json();
  return data.agent;
}

export async function stopAgent(name: string): Promise<Agent> {
  const res = await fetch(`/api/agents/${name}/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error('Failed to stop agent');
  const data = await res.json();
  return data.agent;
}

export async function fetchAgentLogs(name: string, prdId?: string, lines?: number): Promise<{ lines: string[]; file: string | null; connected: boolean }> {
  const params = new URLSearchParams();
  if (prdId) params.append('prdId', prdId);
  if (lines) params.append('lines', lines.toString());
  const res = await fetch(`/api/agents/${name}/logs${params.toString() ? '?' + params.toString() : ''}`);
  if (!res.ok) return { lines: [], file: null, connected: false };
  return res.json();
}

export async function restartAgent(name: string): Promise<Agent> {
  await stopAgent(name);
  return startAgent(name);
}

export async function createPRD(data: { title: string; content: string; status?: string }): Promise<PRD> {
  const res = await fetch('/api/prds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Failed to create PRD');
  return res.json();
}

export async function updatePRD(id: string, data: Partial<{ title: string; content: string; status: string }>): Promise<PRD> {
  const res = await fetch(`/api/prds/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Failed to update PRD');
  return res.json();
}

export async function publishPRD(id: string, repoUrl: string): Promise<PRD> {
  const res = await fetch(`/api/prds/${id}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoUrl }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to publish PRD' }));
    throw new Error(err.error || 'Failed to publish PRD');
  }
  return res.json();
}

export async function submitPRDApproval(prdId: string, data: { agent_id: string; status: string; comments?: string }): Promise<PRDApproval> {
  const res = await fetch(`/api/prds/${prdId}/approvals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Failed to submit approval');
  return res.json();
}

export async function overridePRD(id: string): Promise<PRD> {
  const res = await fetch(`/api/prds/${id}/override`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error('Failed to override PRD');
  return res.json();
}

export async function acceptPRD(id: string): Promise<{ prd: PRD; nextQueued: string | null }> {
  const res = await fetch(`/api/prds/${id}/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error('Failed to accept PRD');
  return res.json();
}

export async function rejectPRD(id: string, reason?: string): Promise<void> {
  const res = await fetch(`/api/prds/${id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason })
  });
  if (!res.ok) throw new Error('Failed to reject PRD');
}

export async function createEvoRecommendation(data: { title: string; description: string; category: string; priority?: string; principles_referenced?: string[] }): Promise<EvoRecommendation> {
  const res = await fetch('/api/evo/recommendations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Failed to create recommendation');
  return res.json();
}

export async function updateEvoRecommendation(id: string, data: { status: 'approved' | 'rejected' | 'implemented' }): Promise<EvoRecommendation> {
  const res = await fetch(`/api/evo/recommendations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Failed to update recommendation');
  return res.json();
}

export async function approveEvoRecommendation(id: string): Promise<EvoRecommendation> {
  return updateEvoRecommendation(id, { status: 'approved' });
}

export async function rejectEvoRecommendation(id: string): Promise<EvoRecommendation> {
  return updateEvoRecommendation(id, { status: 'rejected' });
}

// SSE connection
export interface SSECallback {
  (event: SSEEvent): void;
}

export function connectSSE(onEvent: SSECallback, onError?: (error: Error) => void): () => void {
  const eventSource = new EventSource('/api/events');

  eventSource.onopen = () => {
    // Connection established — send a synthetic connected event
    onEvent({ type: 'connected', data: null, timestamp: new Date().toISOString() });
  };

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onEvent(data);
    } catch (error) {
      if (onError) {
        onError(new Error('Failed to parse SSE event'));
      }
    }
  };

  eventSource.onerror = () => {
    if (eventSource.readyState === EventSource.CLOSED) {
      if (onError) {
        onError(new Error('SSE connection closed'));
      }
    }
    // Don't fire onError for temporary disconnects — EventSource auto-reconnects
  };

  // Return cleanup function
  return () => {
    eventSource.close();
  };
}

// PRD Drafting API
export async function sendDraftingMessage(data: {
  messages: DraftingMessage[];
  phase: 'brainstorm' | 'grilling';
}): Promise<{ message: string; suggestsFinalize: boolean }> {
  const res = await fetch('/api/prds/drafting', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to get PM response' }));
    throw new Error(err.error || 'Failed to get PM response');
  }
  return res.json();
}

export async function synthesizePRD(data: {
  messages: DraftingMessage[];
}): Promise<{ title: string; content: string; grade: PRDGrade }> {
  const res = await fetch('/api/prds/synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to synthesize PRD' }));
    throw new Error(err.error || 'Failed to synthesize PRD');
  }
  return res.json();
}
