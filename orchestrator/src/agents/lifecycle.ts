import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import { pool, query } from '../db/pool';
import { WorktreeManager } from '../worktree/manager';

export interface AgentStatus {
  name: string;
  prdId?: string;
  status: 'active' | 'stopped' | 'idle' | 'error';
  pid?: number;
  worktreePath?: string;
  lastHeartbeat?: Date;
}

interface AgentConfig {
  id: string;
  name: string;
}

// Process key: "prdId:agentName" for per-PRD isolation
function processKey(prdId: string, agentName: string): string {
  return `${prdId}:${agentName}`;
}

// Short PRD ID for worktree paths (first 8 chars of UUID)
function prdShortId(prdId: string): string {
  return prdId.slice(0, 8);
}

export class AgentLifecycleManager {
  private agentsConfigPath: string;
  private projectRoot: string;
  private activeProcesses: Map<string, ChildProcess> = new Map();
  private heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map();
  private healthMonitorInterval: NodeJS.Timeout | null = null;
  private logsDir: string;

  constructor(config: {
    claudeCliPath: string;
    agentsConfigPath: string;
    targetRepoPath: string;
    pool: any;
  }) {
    this.agentsConfigPath = config.agentsConfigPath;
    this.projectRoot = path.resolve(__dirname, '..', '..', '..');
    this.logsDir = path.join(this.projectRoot, 'tmp', 'logs');

    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  /**
   * Is a specific agent currently connected (has a live process in this session)?
   */
  isConnected(agentName: string): boolean {
    return [...this.activeProcesses.keys()].some(k => k.endsWith(`:${agentName}`));
  }

  /**
   * Start the periodic health monitor (every 30s).
   * Detects disconnected agents, cleans stale state, re-spawns for active PRDs.
   */
  startHealthMonitor(): void {
    // Run immediately on startup
    this._healthCheck().catch(err => console.error('Initial health check failed:', err));

    // Then every 30 seconds
    this.healthMonitorInterval = setInterval(() => {
      this._healthCheck().catch(err => console.error('Health check failed:', err));
    }, 30000);

    console.log('Agent health monitor started (30s interval)');
  }

  stopHealthMonitor(): void {
    if (this.healthMonitorInterval) {
      clearInterval(this.healthMonitorInterval);
      this.healthMonitorInterval = null;
    }
  }

  private async _healthCheck(): Promise<void> {
    // Step A: Detect and clean up disconnected agents
    const activeAgents = await query(
      `SELECT name, pid FROM agents WHERE status = 'active' AND pid IS NOT NULL`
    );

    for (const agent of activeAgents.rows) {
      // Check if this agent is in our in-memory Map
      const inMap = this.isConnected(agent.name);

      if (!inMap) {
        // Not in our Map — check if the PID is actually alive (stale from previous session)
        let pidAlive = false;
        try {
          process.kill(agent.pid, 0);
          pidAlive = true;
        } catch {}

        if (pidAlive) {
          // Stale process from previous session — kill it
          try { process.kill(agent.pid, 'SIGTERM'); } catch {}
          console.log(`Health check: killed stale process for '${agent.name}' (PID ${agent.pid})`);
        }

        // Mark as idle so it can be re-spawned
        await query('UPDATE agents SET status = $1, pid = NULL WHERE name = $2', ['idle', agent.name]);
        console.log(`Health check: marked '${agent.name}' as idle (was disconnected)`);
      }
    }

    // Step B: Re-spawn agents for active PRDs that have unfinished tasks
    const activePRDs = await query(
      `SELECT id, metadata FROM prds WHERE status IN ('review', 'approved', 'active')`
    );

    for (const prd of activePRDs.rows) {
      const repoPath = prd.metadata?.repoPath;
      if (!repoPath) continue;

      // Unblock tasks whose dependencies are now done
      const blockedTasks = await query(
        `SELECT t.id, t.external_id, t.description, a.name as agent_name FROM tasks t
         JOIN agents a ON t.assigned_to = a.id
         WHERE t.status = 'blocked' AND t.prd_id = $1`,
        [prd.id]
      );

      for (const bt of blockedTasks.rows) {
        // Check if all mentioned TASK-XXX dependencies are done
        const depMatches = (bt.description || '').match(/TASK-\d+/g) || [];
        if (depMatches.length > 0) {
          const depResult = await query(
            `SELECT COUNT(*) as total, COUNT(CASE WHEN status = 'done' THEN 1 END) as done
             FROM tasks WHERE external_id = ANY($1)`,
            [depMatches]
          );
          const { total, done } = depResult.rows[0];
          const totalN = parseInt(total);
          const doneN = parseInt(done);
          // Unblock if all found deps are done, OR if deps reference tasks that don't exist (stale refs)
          if (totalN === doneN) {
            console.log(`Health check: unblocking ${bt.external_id} — all deps done (${doneN}/${depMatches.length} found)`);
            await query(`UPDATE tasks SET status = 'todo' WHERE id = $1`, [bt.id]);
          }
        }
      }

      // Check for todo/in_progress tasks assigned to agents that aren't connected
      const taskResult = await query(
        `SELECT DISTINCT a.name FROM tasks t
         JOIN agents a ON t.assigned_to = a.id
         WHERE t.status IN ('todo', 'in_progress')
         AND t.prd_id = $1
         AND a.name != 'pm'`,
        [prd.id]
      );

      for (const row of taskResult.rows) {
        if (!this.isConnected(row.name)) {
          try {
            console.log(`Health check: re-spawning '${row.name}' for PRD ${prdShortId(prd.id)}...`);
            await this.startAgent(row.name, repoPath, prd.id);
          } catch (err: any) {
            console.error(`Health check: failed to re-spawn '${row.name}':`, err.message);
          }
        }
      }

      // Also check for tasks in 'review' status (PR waiting for QA)
      const reviewTasks = await query(
        `SELECT DISTINCT a.name FROM tasks t
         JOIN agents a ON t.assigned_to = a.id
         WHERE t.status = 'review' AND t.prd_id = $1`,
        [prd.id]
      );

      // If there are review tasks, make sure QA is connected
      if (reviewTasks.rows.length > 0 && !this.isConnected('qa')) {
        try {
          console.log(`Health check: re-spawning 'qa' for PRD ${prdShortId(prd.id)} (tasks in review)...`);
          await this.startAgent('qa', repoPath, prd.id);
        } catch (err: any) {
          console.error(`Health check: failed to re-spawn 'qa':`, err.message);
        }
      }
    }
  }

  /**
   * Start an agent for a specific PRD.
   */
  async startAgent(agentName: string, repoPath: string, prdId: string): Promise<void> {
    try {
      const result = await query('SELECT id, name FROM agents WHERE name = $1', [agentName]);
      if (result.rows.length === 0) throw new Error(`Agent '${agentName}' not found in database`);

      const agentConfig: AgentConfig = { id: result.rows[0].id, name: result.rows[0].name };

      if (!fs.existsSync(repoPath)) throw new Error(`Target repo not found: ${repoPath}`);

      const prompt = this._generateAgentPrompt(agentName, agentConfig.id);
      await this._spawnAgentWithPrompt(agentName, agentConfig.id, repoPath, prdId, prompt);

      console.log(`Agent '${agentName}' started for PRD ${prdShortId(prdId)}`);
    } catch (error) {
      console.error(`Failed to start agent '${agentName}':`, error);
      await query('UPDATE agents SET status = $1 WHERE name = $2', ['error', agentName]);
      throw error;
    }
  }

  /**
   * Stop all agents for a specific PRD.
   */
  async stopAgentsForPRD(prdId: string): Promise<void> {
    const prefix = `${prdId}:`;
    const toStop: string[] = [];

    for (const key of this.activeProcesses.keys()) {
      if (key.startsWith(prefix)) toStop.push(key);
    }

    for (const key of toStop) {
      const child = this.activeProcesses.get(key);
      const agentName = key.split(':')[1];

      // Clear heartbeat
      const hb = this.heartbeatIntervals.get(key);
      if (hb) { clearInterval(hb); this.heartbeatIntervals.delete(key); }

      // Kill process
      if (child?.pid) {
        try { process.kill(child.pid, 'SIGTERM'); } catch {}
        await new Promise(r => setTimeout(r, 3000));
        try { process.kill(child.pid, 'SIGKILL'); } catch {}
      }

      this.activeProcesses.delete(key);
      await query('UPDATE agents SET status = $1, pid = NULL, worktree_path = NULL WHERE name = $2', ['idle', agentName]);
      console.log(`Stopped agent '${agentName}' for PRD ${prdShortId(prdId)}`);
    }
  }

  /**
   * Stop a specific agent (backward compat — stops all instances of this agent name).
   */
  async stopAgent(agentName: string): Promise<void> {
    for (const key of [...this.activeProcesses.keys()]) {
      if (key.endsWith(`:${agentName}`)) {
        const child = this.activeProcesses.get(key);
        const hb = this.heartbeatIntervals.get(key);
        if (hb) { clearInterval(hb); this.heartbeatIntervals.delete(key); }
        if (child?.pid) {
          try { process.kill(child.pid, 'SIGTERM'); } catch {}
          await new Promise(r => setTimeout(r, 3000));
          try { process.kill(child.pid, 'SIGKILL'); } catch {}
        }
        this.activeProcesses.delete(key);
      }
    }

    // Clean up worktree directory
    const result = await query('SELECT worktree_path FROM agents WHERE name = $1', [agentName]);
    if (result.rows[0]?.worktree_path && fs.existsSync(result.rows[0].worktree_path)) {
      try { fs.rmSync(result.rows[0].worktree_path, { recursive: true, force: true }); } catch {}
    }

    await query('UPDATE agents SET status = $1, pid = NULL, worktree_path = NULL WHERE name = $2', ['idle', agentName]);
  }

  /**
   * Spawn PM specifically for PRD task decomposition.
   */
  async startAgentForDecomposition(prdId: string, repoPath: string): Promise<void> {
    const pmResult = await query('SELECT id, name FROM agents WHERE name = $1', ['pm']);
    if (pmResult.rows.length === 0) throw new Error('PM agent not found');
    const pmId = pmResult.rows[0].id;

    const agentsResult = await query('SELECT id, name, type FROM agents');
    const agentMap = agentsResult.rows.map((a: any) => `${a.name} (${a.type}): ${a.id}`).join('\n');

    const decompositionPrompt = `You are the PM agent. A PRD has been approved by all agents and needs to be decomposed into executable tasks.

CRITICAL RULE: Every task you create must be fully actionable. Agents execute autonomously — they cannot ask the human for input. If the PRD has any remaining ambiguity, YOU make the decision, document it in the task description, and move on. Do NOT create tasks that say "waiting on stakeholder" or "needs human input."

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
   - Do NOT assign tasks to pm (yourself)

4. Create tasks with status "backlog". Set priority based on dependencies.

5. After creating all tasks, update them to "todo" status:
   curl -s -X PATCH http://localhost:3001/api/tasks/<task_id> \\
     -H "Content-Type: application/json" \\
     -d '{"status": "todo"}'

6. Update the PRD status to "active":
   curl -s -X PATCH http://localhost:3001/api/prds/${prdId} \\
     -H "Content-Type: application/json" \\
     -d '{"status": "active"}'

7. If the PRD has open questions, resolve them yourself with [PM Decision] prefix.

Begin now. Read the PRD and create the tasks.`;

    try { await this.stopAgent('pm'); } catch {}
    await new Promise(r => setTimeout(r, 1000));
    await this._spawnAgentWithPrompt('pm', pmId, repoPath, prdId, decompositionPrompt);
    console.log(`PM spawned for task decomposition of PRD '${prdShortId(prdId)}'`);
  }

  /**
   * After an agent exits, spawn agents that have tasks assigned to them.
   */
  private async _spawnAgentsForTasks(repoPath: string, prdId: string): Promise<void> {
    try {
      console.log(`Agent exited (PRD ${prdShortId(prdId)}) — checking for agents with assigned todo tasks...`);

      const taskResult = await query(
        `SELECT DISTINCT a.name FROM tasks t
         JOIN agents a ON t.assigned_to = a.id
         WHERE t.status IN ('todo', 'backlog')
         AND t.prd_id = $1
         AND a.name != 'pm'`,
        [prdId]
      );

      for (const row of taskResult.rows) {
        const key = processKey(prdId, row.name);
        if (this.activeProcesses.has(key)) continue; // already running for this PRD

        try {
          console.log(`Auto-spawning agent '${row.name}' for PRD ${prdShortId(prdId)}...`);
          await this.startAgent(row.name, repoPath, prdId);
        } catch (err: any) {
          console.error(`Failed to auto-spawn '${row.name}':`, err.message);
        }
      }

      // PM coordination fallback
      if (taskResult.rows.length === 0) {
        const stuckResult = await query(
          `SELECT COUNT(*) as stuck FROM tasks WHERE status IN ('todo', 'backlog') AND prd_id = $1`,
          [prdId]
        );
        const stuck = parseInt(stuckResult.rows[0].stuck);

        // Check if any agents are still active for this PRD
        const activeForPRD = [...this.activeProcesses.keys()].filter(k => k.startsWith(`${prdId}:`)).length;

        if (stuck > 0 && activeForPRD === 0) {
          console.log(`${stuck} tasks stuck for PRD ${prdShortId(prdId)} — spawning PM coordinator...`);
          try {
            const pmResult = await query('SELECT id FROM agents WHERE name = $1', ['pm']);
            if (pmResult.rows.length > 0) {
              const coordPrompt = `You are the PM agent running a coordination sweep for PRD ${prdId}. There are tasks stuck in "todo" status.

1. Read the task board: curl -s "http://localhost:3001/api/tasks?prd_id=${prdId}"
2. For each "todo" task, check if dependencies (mentioned in description) are done
3. Message the assigned agents that their tasks are unblocked
4. Check for tasks in "review" with stale PRs — ping dev and QA agents`;
              await this._spawnAgentWithPrompt('pm', pmResult.rows[0].id, repoPath, prdId, coordPrompt);
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
   * Core spawn helper — creates worktree, copies files, spawns process.
   */
  private async _spawnAgentWithPrompt(agentName: string, agentId: string, repoPath: string, prdId: string, prompt: string): Promise<void> {
    // Anti-duplicate guard: if a process already exists for this key, skip
    const key = processKey(prdId, agentName);
    if (this.activeProcesses.has(key)) {
      console.log(`Skipping spawn for '${agentName}' (PRD ${prdShortId(prdId)}) — already running`);
      return;
    }

    const worktreeManager = new WorktreeManager(repoPath);
    // Use PRD-scoped worktree name to avoid collisions
    const worktreeName = `${prdShortId(prdId)}-${agentName}`;
    const worktreePath = await worktreeManager.createWorktree(worktreeName);

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
    env.PRD_ID = prdId;
    env.API_URL = 'http://localhost:3001/api';
    delete env.ANTHROPIC_API_KEY;

    const logFilePath = path.join(this.logsDir, `${prdShortId(prdId)}-${agentName}.log`);
    const logFile = fs.createWriteStream(logFilePath, { flags: 'a' });

    console.log(`Spawning agent '${agentName}' for PRD ${prdShortId(prdId)} in ${worktreePath}...`);

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
      console.log(`Agent '${agentName}' (PRD ${prdShortId(prdId)}) exited with code ${code}`);
      this.activeProcesses.delete(key);
      const hb = this.heartbeatIntervals.get(key);
      if (hb) { clearInterval(hb); this.heartbeatIntervals.delete(key); }
      const exitStatus = code === 0 ? 'idle' : 'error';
      await query('UPDATE agents SET status = $1, pid = NULL WHERE name = $2', [exitStatus, agentName]);

      // Post-exit: check for todo tasks and spawn agents
      if (code === 0) {
        await this._spawnAgentsForTasks(repoPath, prdId);
      }
    });

    this.activeProcesses.set(key, child);
    await query(
      'UPDATE agents SET status = $1, pid = $2, worktree_path = $3, last_heartbeat = NOW() WHERE name = $4',
      ['active', pid, worktreePath, agentName]
    );
    this._monitorHeartbeat(key, agentName, pid);
  }

  /**
   * Get count of active agent processes for a specific PRD.
   */
  getActiveCountForPRD(prdId: string): number {
    return [...this.activeProcesses.keys()].filter(k => k.startsWith(`${prdId}:`)).length;
  }

  /**
   * Stop all agents across all PRDs.
   */
  async stopAll(): Promise<void> {
    for (const [key, child] of this.activeProcesses) {
      const hb = this.heartbeatIntervals.get(key);
      if (hb) { clearInterval(hb); this.heartbeatIntervals.delete(key); }
      if (child.pid) {
        try { process.kill(child.pid, 'SIGTERM'); } catch {}
      }
    }
    this.activeProcesses.clear();
    await query('UPDATE agents SET status = $1, pid = NULL, worktree_path = NULL', ['idle']);
  }

  private _monitorHeartbeat(key: string, agentName: string, pid: number): void {
    const existing = this.heartbeatIntervals.get(key);
    if (existing) clearInterval(existing);

    const interval = setInterval(async () => {
      try {
        process.kill(pid, 0);
        await query('UPDATE agents SET last_heartbeat = NOW() WHERE name = $1', [agentName]);
      } catch {
        console.log(`Agent '${agentName}' process dead (PID ${pid})`);
        this.heartbeatIntervals.delete(key);
        clearInterval(interval);
        this.activeProcesses.delete(key);
        await query('UPDATE agents SET status = $1, pid = NULL WHERE name = $2', ['error', agentName]);
      }
    }, 30000);

    this.heartbeatIntervals.set(key, interval);
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
6. If a final integration test fails, create FIX tasks:
   curl -s -X POST http://localhost:3001/api/tasks \\
     -H "Content-Type: application/json" \\
     -d '{"title": "FIX: <issue>", "description": "<failure details>", "priority": "critical", "prd_id": "<prd_id>", "assigned_to": "<dev_agent_uuid>"}'`;
    } else if (isPM) {
      prWorkflow = `
## PM Coordination Duties
9. You can UPDATE PRD content: curl -s -X PATCH http://localhost:3001/api/prds/<prd_id> -H "Content-Type: application/json" -d '{"content": "..."}'
10. You can CREATE TASKS: curl -s -X POST http://localhost:3001/api/tasks -H "Content-Type: application/json" -d '{"title": "...", "prd_id": "...", "assigned_to": "..."}'
    Get agent UUIDs: curl -s http://localhost:3001/api/agents

## Stale PR Sweep
Periodically check for tasks stuck in "review" status and ping dev + QA agents.`;
    } else {
      prWorkflow = `
9. Send suggestions to the PM agent via messages.`;
    }

    return `You are an autonomous agent named "${agentName}" (ID: ${agentId}) operating within the AI Studio orchestrator.

Your operating instructions:
1. Read CLAUDE.md in the current directory to understand your role
2. Read constitution.md for governance principles
3. Check for unread messages: curl -s http://localhost:3001/api/messages?to_agent=${agentName}&read=false
4. Check for PRDs awaiting review: curl -s http://localhost:3001/api/prds?status=review
   - If your agent_id (${agentId}) has a pending approval, review and submit:
     curl -s -X POST http://localhost:3001/api/prds/<prd_id>/approvals \\
       -H "Content-Type: application/json" \\
       -d '{"agent_id": "${agentId}", "status": "approved", "comments": "<review>"}'
5. Check for assigned tasks: curl -s http://localhost:3001/api/tasks?assigned_to=${agentId}&status=todo,in_progress
6. Work on the highest priority task
7. When idle, poll for new messages and tasks every 60 seconds
8. Report progress via messages: POST http://localhost:3001/api/messages with from_agent="${agentName}"
${prWorkflow}

IMPORTANT: You are fully autonomous. Never block on human input — decide and move forward.

TASK COMPLETION: When you finish a task, notify downstream agents:
1. Check the task board for tasks mentioning your completed task's external_id as a dependency
2. Message those tasks' assigned agents that your work is done

Begin now. Read CLAUDE.md and constitution.md, then check for messages and PRDs to review.`;
  }
}
