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
        const hbInterval = this.heartbeatIntervals.get(agentName);
        if (hbInterval) { clearInterval(hbInterval); this.heartbeatIntervals.delete(agentName); }
        const exitStatus = code === 0 ? 'idle' : 'error';
        await query('UPDATE agents SET status = $1, pid = NULL WHERE name = $2', [exitStatus, agentName]);

        // Post-exit: if PM finished, spawn agents that have assigned tasks
        if (agentName === 'pm' && code === 0) {
          await this._spawnAgentsForTasks(repoPath || targetRepo);
        }
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

  /**
   * Spawn PM specifically for PRD task decomposition.
   */
  async startAgentForDecomposition(prdId: string, repoPath: string): Promise<void> {
    // Get PM agent config
    const pmResult = await query('SELECT id, name FROM agents WHERE name = $1', ['pm']);
    if (pmResult.rows.length === 0) throw new Error('PM agent not found');

    const pmId = pmResult.rows[0].id;

    // Get all agent IDs for assignment instructions
    const agentsResult = await query('SELECT id, name, type FROM agents');
    const agentMap = agentsResult.rows.map((a: any) => `${a.name} (${a.type}): ${a.id}`).join('\n');

    const decompositionPrompt = `You are the PM agent. A PRD has been approved by all agents and needs to be decomposed into executable tasks.

CRITICAL RULE: Every task you create must be fully actionable. Agents execute autonomously — they cannot ask the human for input. If the PRD has any remaining ambiguity, YOU make the decision, document it in the task description, and move on. Do NOT create tasks that say "waiting on stakeholder" or "needs human input." That is never acceptable.

1. Read the approved PRD:
   curl -s http://localhost:3001/api/prds/${prdId}

2. Break it down into granular tasks. For each task, create it via the API:
   curl -s -X POST http://localhost:3001/api/tasks \\
     -H "Content-Type: application/json" \\
     -d '{
       "title": "<task title>",
       "description": "<detailed description with acceptance criteria>",
       "priority": "<critical|high|medium|low>",
       "prd_id": "${prdId}",
       "assigned_to": "<agent UUID from the list below>"
     }'

3. Agent IDs for assignment:
${agentMap}

   Assignment rules:
   - API/server/database work → backend-dev
   - UI components/pages/styling → frontend-dev
   - Test plans/test execution → qa
   - Process/workflow improvements → evo
   - Do NOT assign tasks to pm (yourself) — your job is decomposition, not execution

4. Create tasks with status "backlog". Set priority based on dependencies:
   - Critical: blocks other tasks
   - High: core feature work
   - Medium: supporting features
   - Low: nice-to-haves

5. After creating all tasks, update them to "todo" status:
   curl -s -X PATCH http://localhost:3001/api/tasks/<task_id> \\
     -H "Content-Type: application/json" \\
     -d '{"status": "todo"}'

6. If the PRD has open questions or ambiguity, resolve them yourself:
   - Make a reasonable default decision
   - Document the decision in the relevant task description with "[PM Decision]" prefix
   - Update the PRD with the decision:
     curl -s -X PATCH http://localhost:3001/api/prds/${prdId} \\
       -H "Content-Type: application/json" \\
       -d '{"content": "<updated PRD content with decisions documented>"}'

Begin now. Read the PRD and create the tasks.`;

    // Stop PM if already running
    try { await this.stopAgent('pm'); } catch {}
    await new Promise(r => setTimeout(r, 1000));

    // Start PM with decomposition prompt
    await this._spawnAgentWithPrompt('pm', pmId, repoPath, decompositionPrompt);
    console.log(`PM spawned for task decomposition of PRD '${prdId}'`);
  }

  /**
   * After PM exits, spawn agents that have tasks assigned to them.
   */
  private async _spawnAgentsForTasks(repoPath: string): Promise<void> {
    try {
      console.log('Agent exited — checking for agents with assigned todo tasks...');

      // Find agents that have todo/backlog tasks and aren't running
      const taskResult = await query(
        `SELECT DISTINCT a.name FROM tasks t
         JOIN agents a ON t.assigned_to = a.id
         WHERE t.status IN ('todo', 'backlog')
         AND a.name != 'pm'
         AND a.status NOT IN ('active')`
      );

      for (const row of taskResult.rows) {
        try {
          console.log(`Auto-spawning agent '${row.name}' for assigned tasks...`);
          await this.startAgent(row.name, repoPath);
        } catch (err: any) {
          console.error(`Failed to auto-spawn '${row.name}':`, err.message);
        }
      }

      // PM coordination fallback: if todo tasks remain but no agents are active, re-spawn PM
      if (taskResult.rows.length === 0) {
        const stuckResult = await query(
          `SELECT COUNT(*) as stuck FROM tasks WHERE status IN ('todo', 'backlog')`
        );
        const activeResult = await query(
          `SELECT COUNT(*) as active FROM agents WHERE status = 'active'`
        );
        const stuck = parseInt(stuckResult.rows[0].stuck);
        const active = parseInt(activeResult.rows[0].active);

        if (stuck > 0 && active === 0) {
          console.log(`${stuck} tasks stuck in todo with no active agents — spawning PM coordinator...`);
          try {
            const pmResult = await query('SELECT id FROM agents WHERE name = $1', ['pm']);
            if (pmResult.rows.length > 0) {
              const coordPrompt = `You are the PM agent running a coordination sweep. There are tasks stuck in "todo" status but no agents are working.

1. Read the task board: curl -s http://localhost:3001/api/tasks
2. Read agent statuses: curl -s http://localhost:3001/api/agents
3. For each "todo" task, check if its dependencies (mentioned in description) are satisfied (those tasks are "done")
4. If a task is unblocked, message the assigned agent:
   curl -s -X POST http://localhost:3001/api/messages \\
     -H "Content-Type: application/json" \\
     -d '{"from_agent": "pm", "to_agent": "<agent_name>", "content": "Your task <TASK-ID> is unblocked. All dependencies are complete. Please begin work.", "type": "task_update"}'
5. If a task has no dependencies or all deps are done, it's ready to work on immediately.

Check all todo tasks and notify the right agents.`;
              await this._spawnAgentWithPrompt('pm', pmResult.rows[0].id, repoPath, coordPrompt);
            }
          } catch (err: any) {
            console.error('Failed to spawn PM coordinator:', err.message);
          }
        }
      }
    } catch (err) {
      console.error('Failed to spawn agents for tasks:', err);
    }
  }

  /**
   * Low-level spawn helper used by both startAgent and startAgentForDecomposition.
   */
  private async _spawnAgentWithPrompt(agentName: string, agentId: string, repoPath: string, prompt: string): Promise<void> {
    const worktreeManager = new WorktreeManager(repoPath);
    const worktreePath = await worktreeManager.createWorktree(agentName);

    // Copy CLAUDE.md + constitution.md
    const sourceClaudeMd = this._getAgentClaudeMdPath(agentName);
    if (fs.existsSync(sourceClaudeMd)) {
      await fsPromises.copyFile(sourceClaudeMd, path.join(worktreePath, 'CLAUDE.md'));
    }
    const constitutionSrc = path.join(this.projectRoot, 'constitution.md');
    if (fs.existsSync(constitutionSrc)) {
      await fsPromises.copyFile(constitutionSrc, path.join(worktreePath, 'constitution.md'));
    }

    // Prepare env
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v;
    }
    env.PATH = `/usr/local/bin:${env.PATH || ''}`;
    env.AGENT_NAME = agentName;
    env.AGENT_ID = agentId;
    env.API_URL = 'http://localhost:3001/api';
    delete env.ANTHROPIC_API_KEY;

    const logFilePath = path.join(this.logsDir, `${agentName}.log`);
    const logFile = fs.createWriteStream(logFilePath, { flags: 'a' });

    console.log(`Spawning agent '${agentName}' in ${worktreePath}...`);

    const child = spawn('npx', ['-y', '@anthropic-ai/claude-code', '--dangerously-skip-permissions'], {
      cwd: worktreePath,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (child.stdout) child.stdout.pipe(logFile);
    if (child.stderr) child.stderr.pipe(logFile);
    if (child.stdin) { child.stdin.write(prompt); child.stdin.end(); }

    const pid = child.pid;
    if (!pid) throw new Error(`Failed to spawn process for '${agentName}'`);

    child.on('exit', async (code) => {
      console.log(`Agent '${agentName}' exited with code ${code}`);
      this.activeProcesses.delete(agentName);
      const hb = this.heartbeatIntervals.get(agentName);
      if (hb) { clearInterval(hb); this.heartbeatIntervals.delete(agentName); }
      const exitStatus = code === 0 ? 'idle' : 'error';
      await query('UPDATE agents SET status = $1, pid = NULL WHERE name = $2', [exitStatus, agentName]);

      // Post-exit: check for todo tasks assigned to idle agents and start them
      if (code === 0) {
        await this._spawnAgentsForTasks(repoPath);
      }
    });

    this.activeProcesses.set(agentName, child);
    await query(
      'UPDATE agents SET status = $1, pid = $2, worktree_path = $3, last_heartbeat = NOW() WHERE name = $4',
      ['active', pid, worktreePath, agentName]
    );
    this._monitorHeartbeat(agentName, pid);
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
    const isDevAgent = ['backend-dev', 'frontend-dev'].includes(agentName);
    const isQA = agentName === 'qa';
    const isPM = agentName === 'pm';

    // Role-specific PR workflow
    let prWorkflow = '';

    if (isDevAgent) {
      prWorkflow = `
## PR Workflow (Code Agents)
When you finish coding a task:
1. Commit your changes to your worktree branch
2. Create a PR for QA review:
   curl -s -X POST http://localhost:3001/api/tasks/<task_id>/create-pr \\
     -H "Content-Type: application/json" \\
     -d '{"agent_name": "${agentName}", "title": "<TASK-ID>: <title>", "body": "<description of changes>"}'
3. Message QA that PR is ready:
   curl -s -X POST http://localhost:3001/api/messages \\
     -H "Content-Type: application/json" \\
     -d '{"from_agent": "${agentName}", "to_agent": "qa", "content": "<TASK-ID> PR ready for review: <pr_url>", "type": "pr_review"}'
4. If QA sends feedback, read their comments, fix the code, push, and message QA: "Fixes pushed for <TASK-ID>"
5. Do NOT set status to "done" yourself — QA merges and marks done.`;
    } else if (isQA) {
      prWorkflow = `
## PR Review Workflow (QA Agent — You Are the Merge Gate)
You are the final quality gate. No code merges without your approval.

1. Check for tasks in review: curl -s http://localhost:3001/api/tasks?status=review
2. For each PR, read the diff:
   curl -s http://localhost:3001/api/tasks/<task_id>/pr-diff
3. Review against the task's acceptance criteria (in description)
4. If issues found:
   - Post a PR comment: curl -s -X POST http://localhost:3001/api/tasks/<task_id>/pr-comment \\
       -H "Content-Type: application/json" -d '{"comment": "<your feedback>"}'
   - Message the dev agent: "PR feedback for <TASK-ID>: <summary of issues>"
   - Set task back to in_progress: curl -s -X PATCH http://localhost:3001/api/tasks/<task_id> \\
       -H "Content-Type: application/json" -d '{"status": "in_progress"}'
5. If PR passes review:
   - Merge it: curl -s -X POST http://localhost:3001/api/tasks/<task_id>/merge-pr
   - Message PM: "<TASK-ID> merged — QA approved"
6. If a final integration test fails after merge, create FIX tasks:
   curl -s -X POST http://localhost:3001/api/tasks \\
     -H "Content-Type: application/json" \\
     -d '{"title": "FIX: <issue>", "description": "<failure details + repro steps>", "priority": "critical", "prd_id": "<prd_id>", "assigned_to": "<dev_agent_uuid>"}'
   Message the assigned dev agent with the failure details.`;
    } else if (isPM) {
      prWorkflow = `
## PM Coordination Duties
9. You can UPDATE PRD content directly:
     curl -s -X PATCH http://localhost:3001/api/prds/<prd_id> \\
       -H "Content-Type: application/json" \\
       -d '{"content": "<updated markdown content>"}'
10. You can CREATE TASKS from approved PRDs:
     curl -s -X POST http://localhost:3001/api/tasks \\
       -H "Content-Type: application/json" \\
       -d '{"title": "<task>", "description": "<details>", "priority": "<high|medium|low>", "prd_id": "<prd_id>", "assigned_to": "<agent UUID>"}'
    Get agent UUIDs: curl -s http://localhost:3001/api/agents

## Stale PR Sweep
Periodically check for tasks stuck in "review" status:
  curl -s http://localhost:3001/api/tasks?status=review
If any task has been in review for too long with no recent messages, ping both the dev agent and QA agent:
  "TASK-X has been in review with no activity. Dev: is the code ready? QA: please review."`;
    } else {
      prWorkflow = `
9. You CANNOT update PRDs directly — send suggestions to the PM agent.`;
    }

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
   - Use status "questions" if you have blocking concerns
5. Check for assigned tasks: curl -s http://localhost:3001/api/tasks?assigned_to=${agentId}&status=todo,in_progress
6. Begin working on the highest priority task available to you
7. When idle, poll for new messages and tasks every 60 seconds
8. Report progress through the API: POST http://localhost:3001/api/messages with from_agent="${agentName}"
${prWorkflow}

IMPORTANT: You are fully autonomous. Never block on human input — decide and move forward.

TASK COMPLETION: When you finish a task, notify downstream agents:
1. Check the task board for tasks mentioning your completed task's external_id as a dependency
2. Message those tasks' assigned agents that your work is done

Begin operation now. Start by reading CLAUDE.md and constitution.md, then check for messages and PRDs to review.`;
  }
}
