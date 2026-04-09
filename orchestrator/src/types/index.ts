// Enums
export enum TaskStatus {
  BACKLOG = "backlog",
  TODO = "todo",
  IN_PROGRESS = "in_progress",
  REVIEW = "review",
  QA = "qa",
  DONE = "done",
  BLOCKED = "blocked",
}

export enum TaskPriority {
  CRITICAL = "critical",
  HIGH = "high",
  MEDIUM = "medium",
  LOW = "low",
}

export enum MessageType {
  MESSAGE = "message",
  TASK_UPDATE = "task_update",
  PR_REVIEW = "pr_review",
  QUESTION = "question",
  APPROVAL = "approval",
  ESCALATION = "escalation",
  SYSTEM = "system",
}

export enum PRDStatus {
  DRAFT = "draft",
  REVIEW = "review",
  APPROVED = "approved",
  ACTIVE = "active",
  COMPLETED = "completed",
}

export enum ApprovalStatus {
  PENDING = "pending",
  APPROVED = "approved",
  QUESTIONS = "questions",
  OVERRIDDEN = "overridden",
}

export enum AgentStatus {
  IDLE = "idle",
  ACTIVE = "active",
  ERROR = "error",
  STOPPED = "stopped",
}

export enum AgentType {
  ORCHESTRATOR = "orchestrator",
  ARCHITECT = "architect",
  DEVELOPER = "developer",
  REVIEWER = "reviewer",
  TESTER = "tester",
}

// Domain Models
export interface AgentConfig {
  scope: string[];
  notScope: string[];
  tools: string[];
  skills: string[];
  maxConcurrentTasks: number;
}

export interface AgentMetrics {
  tasksCompleted: number;
  tasksFailed: number;
  avgCompletionTimeMs: number;
  defectRate: number;
  testPassRate: number;
}

export interface Agent {
  id: string;
  name: string;
  displayName: string;
  type: AgentType;
  status: AgentStatus;
  config: AgentConfig;
  metrics: AgentMetrics;
  pid: number | null;
  worktreePath: string | null;
  lastHeartbeat: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Task {
  id: string;
  prdId: string | null;
  assignedAgentId: string | null;
  createdByAgentId: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  estimatedHoursRemaining: number | null;
  actualCompletionTimeMs: number | null;
  gitBranch: string | null;
  gitPR: string | null;
  testResults: string | null;
  qualityScore: number | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  taskId: string | null;
  agentId: string;
  type: MessageType;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface PRD {
  id: string;
  title: string;
  description: string;
  status: PRDStatus;
  goals: string[];
  constraints: string[];
  successCriteria: string[];
  estimatedHours: number;
  completedByAgentId: string | null;
  approvalId: string | null;
  gitBranch: string | null;
  gitCommit: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PRDApproval {
  id: string;
  prdId: string;
  status: ApprovalStatus;
  feedback: string | null;
  approverNotes: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeBaseArticle {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  agentSource: string | null;
  viewCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface EvoRecommendation {
  id: string;
  taskId: string;
  agentId: string;
  category: string;
  title: string;
  description: string;
  isResolved: boolean;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// API Request/Response Types
export interface CreateAgentRequest {
  name: string;
  displayName: string;
  type: AgentType;
  config: AgentConfig;
}

export interface UpdateAgentRequest {
  displayName?: string;
  status?: AgentStatus;
  config?: Partial<AgentConfig>;
  metrics?: Partial<AgentMetrics>;
  pid?: number | null;
  worktreePath?: string | null;
  lastHeartbeat?: Date | null;
}

export interface CreateTaskRequest {
  prdId?: string;
  assignedAgentId?: string;
  title: string;
  description: string;
  priority?: TaskPriority;
  estimatedHoursRemaining?: number;
}

export interface UpdateTaskRequest {
  assignedAgentId?: string;
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  estimatedHoursRemaining?: number;
  actualCompletionTimeMs?: number;
  gitBranch?: string;
  gitPR?: string;
  testResults?: string;
  qualityScore?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateMessageRequest {
  taskId?: string;
  agentId: string;
  type: MessageType;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface CreatePRDRequest {
  title: string;
  description: string;
  goals: string[];
  constraints: string[];
  successCriteria: string[];
  estimatedHours: number;
}

export interface UpdatePRDRequest {
  title?: string;
  description?: string;
  status?: PRDStatus;
  goals?: string[];
  constraints?: string[];
  successCriteria?: string[];
  estimatedHours?: number;
  completedByAgentId?: string;
  gitBranch?: string;
  gitCommit?: string;
}

export interface CreatePRDApprovalRequest {
  prdId: string;
}

export interface UpdatePRDApprovalRequest {
  status: ApprovalStatus;
  feedback?: string;
  approverNotes?: string;
}

export interface CreateKnowledgeBaseArticleRequest {
  title: string;
  content: string;
  category: string;
  tags: string[];
  agentSource?: string;
}

export interface UpdateKnowledgeBaseArticleRequest {
  title?: string;
  content?: string;
  category?: string;
  tags?: string[];
}

export interface CreateEvoRecommendationRequest {
  taskId: string;
  agentId: string;
  category: string;
  title: string;
  description: string;
}

export interface UpdateEvoRecommendationRequest {
  title?: string;
  description?: string;
  isResolved?: boolean;
}

// Generic API Response Type
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: Date;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
