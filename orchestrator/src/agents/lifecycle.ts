import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import { pool, query } from '../db/pool';
import { WorktreeManager } from '../worktree/manager';

export interface AgentStatus {
  name: string;
  status: 'active' | 'stopped' | 'error';
  pid?: number;
  uptime?: number;
  memoryUsageMB?: number;
  worktreePath?: string;
  lastHeartbeat?: Date;
}

export interface HealthReport {
  timestamp: Date;
  totalAgents: number;
  activeAgents: number;
  stoppedAgents: number;
  errorAgents: number;
  agents: AgentStatus[];
}

interface AgentConfig {
  id: string;
  name: string;
}

export class AgentLifecycleManager {
  private agentsConfigPath: string;
  private projectRoot: string;
  private activeProcesses: Map<string, ChildProcess> = new Map();
  private heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map();
  private logsDir: string;

  constructor(config: {
    claudeCliPath: string;
    agentsConfigPath: string;
    targetRepoPath: string;
    pool: any;
  }) {
    this.agentsConfigPath = config.agentsConfigPath;
    // Project root is the parent of orchestrator/
    this.projectRoot = path.resolve(__dirname, '..', '..', '..');
    this.logsDir = path.join(this.projectRoot, 'tmp', 'logs');

    // Ensure logs directory exists
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  /**
   * Start an agent with a specific target repo path (per-PRD).
   * If no repoPath provided, falls back to env TARGET_REPO_PATH.
   */
  async startAgent(agentName: string, repoPath?: string): Promise<void> {
    try {
      // Query PG for agent config
      const result = await query(
        'SELECT id, name FROM agents WHERE name = $1',
        [agentName]
      );

      if (result.rows.length === 0) {
        throw new Error(`Agent '${agentName}' not found in database`);
      }

      const agentConfig: AgentConfig = {
        id: result.rows[0].id,
        name: result.rows[0].name,
      };

      // Determine target repo
      const targetRepo = repoPath || path.resolve(this.projectRoot, process.env.TARGET_REPO_PATH || './tmp/target-repo');
      if (!fs.existsSync(targetRepo)) {
        throw new Error(`Target repo not found: ${targetRepo}`);
      }

      // Create a git worktree for the agent
      const worktreeManager = new WorktreeManager(targetRepo);
      const worktreePath = await worktreeManager.createWorktree(agentName);

      // Copy agent's CLAUDE.md into the worktree
      const sourceClaudeMd = this._getAgentClaudeMdPath(agentName);
      const targetClaudeMd = path.join(worktreePath, 'CLAUDE.md');
      if (fs.existsSync(sourceClaudeMd)) {
        await fsPromises.copyFile(sourceClaudeMd, targetClaudeMd);
      }

      // Copy constitution.md into the worktree
      const constitutionSrc = path.join(this.projectRoot, 'constitution.md');
      const constitutionDst = path.join(worktreePath, 'constitution.md');
      if (fs.existsSync(constitutionSrc)) {
        await fsPromises.copyFile(constitutionSrc, constitutionDst);
      }

      // Prepare environment variables
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (v !== undefined) env[k] = v;
      }
      env.PATH = `/usr/local/bin:${env.PATH || ''}`;
      env.AGENT_NAME = agentName;
      env.AGENT_ID = agentConfig.id;
      env.API_URL = 'http://localhost:3001/api';
      // Remove empty ANTHROPIC_API_KEY so CLI uses OAuth auth
      delete env.ANTHROPIC_API_KEY;

      // Create prompt for the agent
      const prompt = this._generateAgentPrompt(agentName, agentConfig.id);

      // Spawn claude CLI process via npx
      const logFilePath = path.join(this.logsDir, `${agentName}.log`);
      const logFile = fs.createWriteStream(logFilePath, { flags: 'a' });

      console.log(`Spawning agent '${agentName}' in ${worktreePath}...`);

      const child = spawn('npx', ['-y', '@anthropic-ai/claude-code', '--dangerously-skip-permissions'], {
        cwd: worktreePath,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Pipe stdout/stderr to log file
      if (child.stdout) child.stdout.pipe(logFile);
      if (child.stderr) child.stderr.pipe(logFile);

      // Write initial prompt to stdin
      if (child.stdin) {
        child.stdin.write(prompt);
        child.stdin.end();
      }

      const pid = child.pid;
      if (!pid) {
        throw new Error(`Failed to spawn claude process for agent '${agentName}'`);
      }

      // Handle clean exit — agent finished its work
      child.on('exit', async (code) => {
        console.log(`Agent '${agentName}' exited with code ${code}`);
        this.activeProcesses.delete(agentName);
        const interval = this.heartbeatIntervals.get(agentName);
        if (interval) { clearInterval(interval); this.heartbeatIntervals.delete(agentName); }
        // Clean exit (code 0) = idle, crash = error
        const exitStatus = code === 0 ? 'idle' : 'error';
        await query('UPDATE agents SET status = $1, pid = NULL WHERE name = $2', [exitStatus, agentName]);
      });

      // Store process reference
      this.activeProcesses.set(agentName, child);

      // Update PG with agent status
      await query(
        `UPDATE agents
         SET status = $1, pid = $2, worktree_path = $3, last_heartbeat = NOW()
         WHERE name = $4`,
        ['active', pid, worktreePath, agentName]
      );

      // Start heartbeat monitoring
      this._monitorHeartbeat(agentName, pid);

      console.log(`Agent '${agentName}' started with PID ${pid}`);
    } catch (error) {
      console.error(`Failed to start agent '${agentName}':`, error);
      await query(
        `UPDATE agents SET status = $1 WHERE name = $2`,
        ['error', agentName]
      );
      throw error;
    }
  }

  async stopAgent(agentName: string): Promise<void> {
    try {
      // Get agent info from database
      const result = await query(
        'SELECT pid, worktree_path FROM agents WHERE name = $1',
        [agentName]
      );

      if (result.rows.length === 0) {
        throw new Error(`Agent '${agentName}' not found`);
      }

      const pid = result.rows[0].pid;
      const worktreePath = result.rows[0].worktree_path;

      // Clear heartbeat interval
      const interval = this.heartbeatIntervals.get(agentName);
      if (interval) {
        clearInterval(interval);
        this.heartbeatIntervals.delete(agentName);
      }

      // Kill process
      if (pid) {
        try {
          process.kill(pid, 'SIGTERM');
          await new Promise((resolve) => setTimeout(resolve, 5000));
          try { process.kill(pid, 'SIGKILL'); } catch {}
        } catch {}
      }

      // Remove process from active list
      this.activeProcesses.delete(agentName);

      // Clean up worktree directory (but don't mess with git worktree tracking
      // since we may not know the target repo path anymore)
      if (worktreePath && fs.existsSync(worktreePath)) {
        try {
          fs.rmSync(worktreePath, { recursive: true, force: true });
        } catch {}
      }

      // Update PG
      await query(
        `UPDATE agents
         SET status = $1, pid = NULL, worktree_path = NULL
         WHERE name = $2`,
        ['idle', agentName]
      );

      console.log(`Agent '${agentName}' stopped`);
    } catch (error) {
      console.error(`Failed to stop agent '${agentName}':`, error);
      throw error;
    }
  }

  async restartAgent(agentName: string): Promise<void> {
    await this.stopAgent(agentName);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await this.startAgent(agentName);
  }

  async getAgentStatus(agentName: string): Promise<AgentStatus> {
    const result = await query(
      'SELECT name, status, pid, worktree_path, last_heartbeat FROM agents WHERE name = $1',
      [agentName]
    );

    if (result.rows.length === 0) {
      throw new Error(`Agent '${agentName}' not found`);
    }

    const row = result.rows[0];
    const status: AgentStatus = {
      name: row.name,
      status: row.status,
      pid: row.pid,
      worktreePath: row.worktree_path,
      lastHeartbeat: row.last_heartbeat ? new Date(row.last_heartbeat) : undefined,
    };

    // Verify process is alive
    if (row.pid) {
      try {
        process.kill(row.pid, 0);
      } catch {
        status.status = 'error';
      }
    }

    return status;
  }

  async stopAll(): Promise<void> {
    const result = await query('SELECT name FROM agents WHERE status = $1', ['active']);
    for (const row of result.rows) {
      try { await this.stopAgent(row.name); } catch {}
    }
  }

  async healthCheck(): Promise<HealthReport> {
    const result = await query('SELECT name, status FROM agents');
    const statuses: AgentStatus[] = [];
    let active = 0, stopped = 0, errored = 0;

    for (const row of result.rows) {
      const s = await this.getAgentStatus(row.name);
      statuses.push(s);
      if (s.status === 'active') active++;
      else if (s.status === 'error') errored++;
      else stopped++;
    }

    return {
      timestamp: new Date(),
      totalAgents: result.rows.length,
      activeAgents: active,
      stoppedAgents: stopped,
      errorAgents: errored,
      agents: statuses,
    };
  }

  private _monitorHeartbeat(agentName: string, pid: number): void {
    const existing = this.heartbeatIntervals.get(agentName);
    if (existing) clearInterval(existing);

    const interval = setInterval(async () => {
      try {
        process.kill(pid, 0);
        await query('UPDATE agents SET last_heartbeat = NOW() WHERE name = $1', [agentName]);
      } catch {
        console.log(`Agent '${agentName}' process is dead (PID ${pid})`);
        this.heartbeatIntervals.delete(agentName);
        clearInterval(interval);
        // Mark as error, don't auto-restart for now
        await query('UPDATE agents SET status = $1 WHERE name = $2', ['error', agentName]);
      }
    }, 30000);

    this.heartbeatIntervals.set(agentName, interval);
  }

  private _getAgentClaudeMdPath(agentName: string): string {
    const possiblePaths = [
      path.resolve(this.agentsConfigPath, agentName, 'CLAUDE.md'),
      path.resolve(this.agentsConfigPath, `${agentName}.md`),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) return p;
    }

    return possiblePaths[0];
  }

  private _generateAgentPrompt(agentName: string, agentId: string): string {
    const pmSection = agentName === 'pm' ? `
9. You can UPDATE PRD content directly:
     curl -s -X PATCH http://localhost:3001/api/prds/<prd_id> \\
       -H "Content-Type: application/json" \\
       -d '{"content": "<updated markdown content>"}'
   This auto-increments the version. Use this to incorporate agent feedback, resolve open questions, and keep the PRD as the source of truth.` : `
9. You CANNOT update PRDs directly — only the PM agent can modify PRD content.
   If you have suggestions for PRD changes, include them in your approval comments or send a message to the PM agent:
     curl -s -X POST http://localhost:3001/api/messages \\
       -H "Content-Type: application/json" \\
       -d '{"from_agent": "${agentName}", "to_agent": "pm", "content": "<your suggestion>", "type": "message"}'`;

    return `You are an autonomous agent named "${agentName}" (ID: ${agentId}) operating within the AI Studio orchestrator.

Your operating instructions:
1. Read CLAUDE.md in the current directory to understand your role and capabilities
2. Read constitution.md in the current directory to understand the system's governance principles
3. Check for unread messages: curl -s http://localhost:3001/api/messages?to_agent=${agentName}&read=false
4. Check for PRDs awaiting your review: curl -s http://localhost:3001/api/prds?status=review
   - For each PRD in review, check if you have a pending approval:
     curl -s http://localhost:3001/api/prds/<prd_id>/approvals
   - If your agent_id (${agentId}) has status "pending", review the PRD content and submit your approval:
     curl -s -X POST http://localhost:3001/api/prds/<prd_id>/approvals \\
       -H "Content-Type: application/json" \\
       -d '{"agent_id": "${agentId}", "status": "approved", "comments": "<your review comments>"}'
   - Use status "approved" if the PRD is clear and actionable for your role
   - Use status "questions" if you have blocking concerns, and include your questions in comments
5. Check for assigned tasks: curl -s http://localhost:3001/api/tasks?assigned_to=${agentId}&status=todo,in_progress
6. Begin working on the highest priority task available to you
7. When idle, poll for new messages and tasks every 60 seconds
8. Report progress through the API: POST http://localhost:3001/api/messages with from_agent="${agentName}"
${pmSection}

Begin operation now. Start by reading CLAUDE.md and constitution.md, then check for messages and PRDs to review.`;
  }
}
