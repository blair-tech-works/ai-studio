import { Router, Request, Response } from 'express';
import { pool, query } from '../db/pool';
import { v4 as uuidv4 } from 'uuid';
import { broadcast } from './events';
import { exec, execSync, spawn } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, basename } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { PM_GRILLING_PROMPT, PM_SYNTHESIS_PROMPT } from './prompts/pm-drafter';

const router = Router();

const CLAUDE_CLI_PATH = process.env.CLAUDE_CLI_PATH || 'claude';

// Map common aliases to current model IDs; pass through full model strings.
function resolveModel(alias: string): string {
  const map: Record<string, string> = {
    sonnet: 'claude-sonnet-4-5',
    opus: 'claude-opus-4-5',
    haiku: 'claude-haiku-4-5',
  };
  return map[alias.toLowerCase()] || alias;
}

// SDK path — used when ANTHROPIC_API_KEY is set. Works anywhere.
let anthropicClient: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (anthropicClient) return anthropicClient;
  anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropicClient;
}

async function callClaudeViaSDK(userPrompt: string, systemPrompt: string): Promise<string> {
  const model = resolveModel(process.env.PM_MODEL || 'sonnet');
  const res = await getAnthropic().messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

// CLI path — used when no ANTHROPIC_API_KEY. Uses the user's Claude Code OAuth
// from the keychain. REQUIRES the orchestrator to be started OUTSIDE another
// Claude Code session (otherwise the CLI errors out: "Claude Code cannot be
// launched inside another Claude Code session").
function callClaudeViaCLI(userPrompt: string, systemPrompt: string): Promise<string> {
  if (process.env.CLAUDECODE) {
    return Promise.reject(new Error(
      'PM agent unavailable: the orchestrator is running inside another Claude Code session, ' +
        'which prevents the `claude` CLI from authenticating. Start the orchestrator from a plain ' +
        'terminal (`npm run dev:orchestrator`) — or set ANTHROPIC_API_KEY in orchestrator/.env to ' +
        'use the SDK instead.'
    ));
  }

  const model = process.env.PM_MODEL || 'sonnet';
  return new Promise((resolveP, reject) => {
    const child = spawn(
      CLAUDE_CLI_PATH,
      ['-p', '--model', model, '--append-system-prompt', systemPrompt],
      { env: process.env }
    );

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Claude CLI timed out after 180s'));
    }, 180_000);

    child.stdout.on('data', (c) => { stdout += c.toString(); });
    child.stderr.on('data', (c) => { stderr += c.toString(); });

    child.on('error', (err) => {
      clearTimeout(timer);
      console.error('Claude CLI spawn error:', err);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        console.error('Claude CLI non-zero exit:', { code, stderr, stdout: stdout.slice(0, 500) });
        return reject(new Error(stderr.trim() || stdout.trim() || `claude exited with code ${code}`));
      }
      resolveP(stdout.trim());
    });

    child.stdin.write(userPrompt);
    child.stdin.end();
  });
}

// Picks the SDK if ANTHROPIC_API_KEY is set, otherwise falls back to the CLI
// (which uses the user's Claude Code OAuth). Either way, callers see the same
// async string contract.
async function callClaude(userPrompt: string, systemPrompt: string): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY) {
    return callClaudeViaSDK(userPrompt, systemPrompt);
  }
  return callClaudeViaCLI(userPrompt, systemPrompt);
}

// Helper: save initial PRD draft to tmp/prds/ (pre-repo backup, before git commit)
// Once published, the PRD lives in the target git repo as PRD.md and in the database.
function saveDraftPRDToDisk(title: string, content: string, id: string): string {
  const projectRoot = resolve(__dirname, '..', '..', '..');
  const prdsDir = join(projectRoot, 'tmp', 'prds');
  if (!existsSync(prdsDir)) mkdirSync(prdsDir, { recursive: true });

  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  const filename = `DRAFT-${slug}-${id.slice(0, 8)}.md`;
  const filepath = join(prdsDir, filename);

  writeFileSync(filepath, content);
  console.log(`Draft PRD saved to disk: ${filepath}`);
  return filepath;
}

// GET /api/prds - list PRDs
router.get('/', async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string;

    let sql = 'SELECT * FROM prds WHERE 1=1';
    const values: any[] = [];
    let paramCount = 1;

    if (status) {
      sql += ` AND status = $${paramCount}`;
      values.push(status);
      paramCount++;
    }

    sql += ' ORDER BY created_at DESC';

    const result = await query(sql, values);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching PRDs:', error);
    res.status(500).json({ error: 'Failed to fetch PRDs' });
  }
});

// POST /api/prds - create a new PRD
router.post('/', async (req: Request, res: Response) => {
  try {
    const { title, content, status } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: 'title and content are required' });
    }

    const id = uuidv4();
    const prd_status = status || 'draft';
    const version = 1;

    const result = await query(
      `INSERT INTO prds (id, title, content, status, version)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, title, content, prd_status, version]
    );

    // Save draft PRD to disk (pre-repo backup)
    const filepath = saveDraftPRDToDisk(title, content, id);
    const prd = result.rows[0];
    prd.filepath = filepath;

    res.status(201).json(prd);
  } catch (error) {
    console.error('Error creating PRD:', error);
    res.status(500).json({ error: 'Failed to create PRD' });
  }
});

// POST /api/prds/drafting - PM agent conversation turn
router.post('/drafting', async (req: Request, res: Response) => {
  try {
    const { messages, phase } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    // Build conversation transcript as the prompt
    const transcript = messages
      .map((msg: { role: string; content: string }) =>
        `${msg.role === 'human' ? 'Human' : 'PM Agent'}: ${msg.content}`
      )
      .join('\n\n');

    const prompt = phase === 'brainstorm'
      ? `The human just shared their initial brain dump for a new product/feature. Review it, acknowledge what you understood, and start asking probing questions.\n\n---\n\nHuman: ${messages[0].content}`
      : `Here is the conversation so far. Continue as the PM Agent — respond to the human's latest message and ask follow-up questions.\n\n---\n\n${transcript}`;

    const responseText = await callClaude(prompt, PM_GRILLING_PROMPT);

    // Parse coverage signal from last line
    const suggestsFinalize = responseText.includes('[COVERAGE: sufficient]');
    // Strip the coverage tag from the visible message
    const message = responseText.replace(/\n?\[COVERAGE: (needs_more|sufficient)\]\s*$/, '').trim();

    res.json({ message, suggestsFinalize });
  } catch (error) {
    console.error('Error in PRD drafting:', error);
    const msg = error instanceof Error ? error.message : 'Failed to get PM response';
    res.status(502).json({ error: msg });
  }
});

// POST /api/prds/synthesize - synthesize conversation into structured PRD + grade
router.post('/synthesize', async (req: Request, res: Response) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    // Build conversation transcript
    const transcript = messages
      .map((msg: { role: string; content: string }) =>
        `**${msg.role === 'human' ? 'Human' : 'PM Agent'}:** ${msg.content}`
      )
      .join('\n\n');

    const prompt = `Here is the full PRD drafting conversation. Synthesize it into a structured PRD and grade it.\n\n---\n\n${transcript}`;

    const responseText = await callClaude(prompt, PM_SYNTHESIS_PROMPT);

    // Parse grade JSON from the response
    const gradeMatch = responseText.match(/```grade\n([\s\S]*?)\n```/);
    let grade = null;
    if (gradeMatch) {
      try {
        grade = JSON.parse(gradeMatch[1]);
      } catch {
        console.error('Failed to parse grade JSON');
      }
    }

    // Extract title from first heading
    const titleMatch = responseText.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : 'Untitled PRD';

    // Content is everything before the grade block
    const content = responseText.replace(/```grade\n[\s\S]*?\n```/, '').trim();

    res.json({ title, content, grade });
  } catch (error) {
    console.error('Error synthesizing PRD:', error);
    const msg = error instanceof Error ? error.message : 'Failed to synthesize PRD';
    res.status(502).json({ error: msg });
  }
});

// GET /api/prds/:id - get PRD with its approval statuses
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const prdResult = await query(
      'SELECT * FROM prds WHERE id = $1',
      [id]
    );

    if (prdResult.rows.length === 0) {
      return res.status(404).json({ error: 'PRD not found' });
    }

    const approvalsResult = await query(
      'SELECT * FROM prd_approvals WHERE prd_id = $1 ORDER BY created_at ASC',
      [id]
    );

    const prd = prdResult.rows[0];
    prd.approvals = approvalsResult.rows;

    res.json(prd);
  } catch (error) {
    console.error('Error fetching PRD:', error);
    res.status(500).json({ error: 'Failed to fetch PRD' });
  }
});

// PATCH /api/prds/:id - update PRD content/status, increment version
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, content, status } = req.body;

    // Get current version
    const currentResult = await query(
      'SELECT version FROM prds WHERE id = $1',
      [id]
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: 'PRD not found' });
    }

    const newVersion = (currentResult.rows[0].version || 1) + 1;

    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (title !== undefined) {
      updates.push(`title = $${paramCount++}`);
      values.push(title);
    }
    if (content !== undefined) {
      updates.push(`content = $${paramCount++}`);
      values.push(content);
    }
    if (status !== undefined) {
      updates.push(`status = $${paramCount++}`);
      values.push(status);
    }

    updates.push(`version = $${paramCount++}`);
    values.push(newVersion);
    updates.push(`updated_at = NOW()`);

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    values.push(id);

    const result = await query(
      `UPDATE prds
       SET ${updates.join(', ')}
       WHERE id = $${paramCount}
       RETURNING *`,
      values
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating PRD:', error);
    res.status(500).json({ error: 'Failed to update PRD' });
  }
});

// POST /api/prds/:id/publish - clone repo, set status to 'review', create approvals, start agents
router.post('/:id/publish', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { repoUrl } = req.body;

    if (!repoUrl) {
      return res.status(400).json({ error: 'repoUrl is required' });
    }

    // Clone the repo into tmp/repos/<repo-name>/
    const projectRoot = resolve(__dirname, '..', '..', '..');
    const repoName = basename(repoUrl.replace(/\.git$/, ''));
    const repoPath = join(projectRoot, 'tmp', 'repos', repoName);

    const gitEnv = { ...process.env, PATH: `/usr/local/bin:${process.env.PATH}` };

    if (!existsSync(repoPath)) {
      mkdirSync(join(projectRoot, 'tmp', 'repos'), { recursive: true });
      console.log(`Cloning ${repoUrl} into ${repoPath}...`);
      execSync(`git clone "${repoUrl}" "${repoPath}"`, {
        stdio: 'pipe',
        env: gitEnv,
        timeout: 120000,
      });
    } else {
      // Repo already cloned, pull latest
      console.log(`Repo already cloned at ${repoPath}, pulling latest...`);
      try {
        execSync(`git -C "${repoPath}" pull`, { stdio: 'pipe', timeout: 30000 });
      } catch {}
    }

    // Seed empty repos with an initial commit (required for git worktrees)
    try {
      execSync(`git -C "${repoPath}" rev-parse HEAD`, { stdio: 'pipe' });
    } catch {
      console.log(`Repo has no commits, creating initial commit...`);
      execSync(`git -C "${repoPath}" commit --allow-empty -m "Initial commit (created by AI Studio PM)"`, {
        stdio: 'pipe',
        env: gitEnv,
      });
      try {
        execSync(`git -C "${repoPath}" push origin main`, { stdio: 'pipe', env: gitEnv, timeout: 30000 });
      } catch {}
    }

    // Copy PRD markdown into the repo and commit+push
    try {
      const prdRow = await query('SELECT title, content FROM prds WHERE id = $1', [id]);
      if (prdRow.rows.length > 0) {
        const prdContent = prdRow.rows[0].content;
        const prdTitle = prdRow.rows[0].title;
        const prdFilename = 'PRD.md';
        writeFileSync(join(repoPath, prdFilename), prdContent);
        execSync(`git -C "${repoPath}" add "${prdFilename}"`, { stdio: 'pipe' });
        execSync(`git -C "${repoPath}" commit -m "Add PRD: ${prdTitle.replace(/"/g, '\\"')}"`, {
          stdio: 'pipe',
          env: gitEnv,
        });
        try {
          execSync(`git -C "${repoPath}" push origin main`, { stdio: 'pipe', env: gitEnv, timeout: 30000 });
        } catch {}
        console.log(`PRD committed to repo: ${repoPath}/${prdFilename}`);
      }
    } catch (err: any) {
      console.error('Failed to commit PRD to repo:', err.message);
    }

    // Concurrency check: how many PRDs are actively using agent slots?
    const concurrencyLimit = parseInt(process.env.MAX_CONCURRENT_PRDS || '1');
    const activeResult = await query(`SELECT COUNT(*) as active FROM prds WHERE status = 'active'`);
    const activePRDs = parseInt(activeResult.rows[0].active);

    if (activePRDs >= concurrencyLimit) {
      // Queue this PRD — store repo info but don't start agents
      await query(
        `UPDATE prds SET metadata = metadata || $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify({ repoUrl, repoPath, queued: true }), id]
      );
      return res.json({ queued: true, message: `${activePRDs} PRD(s) currently active (limit: ${concurrencyLimit}). This PRD is queued.` });
    }

    // Update PRD status and store repo info in metadata
    const prdResult = await query(
      `UPDATE prds
       SET status = 'review', metadata = metadata || $1::jsonb, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify({ repoUrl, repoPath }), id]
    );

    if (prdResult.rows.length === 0) {
      return res.status(404).json({ error: 'PRD not found' });
    }

    // Get all agents (active or idle)
    const agentsResult = await query(
      "SELECT id, name FROM agents WHERE status IN ('active', 'idle', 'error')"
    );

    // Create pending approval records
    const approvals = [];
    for (const agent of agentsResult.rows) {
      const approvalId = uuidv4();
      try {
        const approvalResult = await query(
          `INSERT INTO prd_approvals (id, prd_id, agent_id, status)
           VALUES ($1, $2, $3, 'pending')
           ON CONFLICT (prd_id, agent_id) DO UPDATE SET status = 'pending', updated_at = NOW()
           RETURNING *`,
          [approvalId, id, agent.id]
        );
        approvals.push(approvalResult.rows[0]);
      } catch {}
    }

    // Auto-start all agents with this repo
    const lifecycleManager = req.app.get('lifecycleManager');
    if (lifecycleManager) {
      for (const agent of agentsResult.rows) {
        try {
          // Stop if already running
          try { await lifecycleManager.stopAgent(agent.name); } catch {}
          await lifecycleManager.startAgent(agent.name, repoPath, id);
        } catch (err: any) {
          console.error(`Failed to start agent '${agent.name}':`, err.message);
        }
      }
    }

    const prd = prdResult.rows[0];
    prd.approvals = approvals;

    res.json(prd);
  } catch (error: any) {
    console.error('Error publishing PRD:', error);
    res.status(500).json({ error: error.message || 'Failed to publish PRD' });
  }
});

// GET /api/prds/:id/approvals - get all approval records
router.get('/:id/approvals', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      'SELECT * FROM prd_approvals WHERE prd_id = $1 ORDER BY created_at ASC',
      [id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching approvals:', error);
    res.status(500).json({ error: 'Failed to fetch approvals' });
  }
});

// POST /api/prds/:id/approvals - submit an approval
router.post('/:id/approvals', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { agent_id, status, comments } = req.body;

    if (!agent_id || !status) {
      return res.status(400).json({ error: 'agent_id and status are required' });
    }

    // Find or create approval record
    const existingResult = await query(
      `SELECT * FROM prd_approvals
       WHERE prd_id = $1 AND agent_id = $2`,
      [id, agent_id]
    );

    let result;
    if (existingResult.rows.length > 0) {
      // Update existing
      result = await query(
        `UPDATE prd_approvals
         SET status = $1, comments = $2, updated_at = NOW()
         WHERE prd_id = $3 AND agent_id = $4
         RETURNING *`,
        [status, comments || null, id, agent_id]
      );
    } else {
      // Create new
      const approvalId = uuidv4();
      result = await query(
        `INSERT INTO prd_approvals (id, prd_id, agent_id, status, comments)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [approvalId, id, agent_id, status, comments || null]
      );
    }

    const approval = result.rows[0];

    // Check for consensus: all approvals approved or overridden?
    const consensusResult = await query(
      `SELECT COUNT(*) as total,
              COUNT(CASE WHEN status IN ('approved', 'overridden') THEN 1 END) as resolved
       FROM prd_approvals WHERE prd_id = $1`,
      [id]
    );
    const { total, resolved } = consensusResult.rows[0];

    if (parseInt(total) > 0 && parseInt(total) === parseInt(resolved)) {
      // Consensus reached — transition PRD to approved
      const prdResult = await query(
        `UPDATE prds SET status = 'approved', updated_at = NOW() WHERE id = $1 AND status = 'review' RETURNING *`,
        [id]
      );

      if (prdResult.rows.length > 0) {
        console.log(`PRD '${id}' approved by consensus!`);
        const prd = prdResult.rows[0];
        const repoPath = prd.metadata?.repoPath;

        // Auto-spawn PM for task decomposition
        const lifecycleManager = req.app.get('lifecycleManager');
        if (lifecycleManager && repoPath) {
          try {
            await lifecycleManager.startAgentForDecomposition(id, repoPath);
          } catch (err: any) {
            console.error('Failed to start PM for decomposition:', err.message);
          }
        }
      }
    }

    res.json(approval);
  } catch (error) {
    console.error('Error submitting approval:', error);
    res.status(500).json({ error: 'Failed to submit approval' });
  }
});

// POST /api/prds/:id/override - human override
router.post('/:id/override', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Update all pending/questions approvals to 'overridden'
    await query(
      `UPDATE prd_approvals
       SET status = 'overridden', updated_at = NOW()
       WHERE prd_id = $1 AND status IN ('pending', 'questions')`,
      [id]
    );

    // Update PRD status to 'approved'
    const result = await query(
      `UPDATE prds
       SET status = 'approved', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'PRD not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error overriding approvals:', error);
    res.status(500).json({ error: 'Failed to override approvals' });
  }
});

// POST /api/prds/:id/accept — human accepts completed PRD, frees concurrency slot
router.post('/:id/accept', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Get PRD info
    const prdResult = await query('SELECT * FROM prds WHERE id = $1', [id]);
    if (prdResult.rows.length === 0) return res.status(404).json({ error: 'PRD not found' });

    // Kill all agents for this PRD
    const lifecycleManager = req.app.get('lifecycleManager');
    if (lifecycleManager) {
      await lifecycleManager.stopAgentsForPRD(id);
    }

    // Mark PRD as completed
    const result = await query(
      `UPDATE prds SET status = 'completed', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );

    // Check for queued PRDs and auto-start the next one
    const queuedResult = await query(
      `SELECT id, metadata FROM prds WHERE metadata->>'queued' = 'true' ORDER BY created_at ASC LIMIT 1`
    );
    let nextPRD = null;
    if (queuedResult.rows.length > 0) {
      nextPRD = queuedResult.rows[0];
      // Clear queued flag and re-publish
      await query(
        `UPDATE prds SET metadata = metadata - 'queued', updated_at = NOW() WHERE id = $1`,
        [nextPRD.id]
      );
      console.log(`Slot freed — auto-starting queued PRD ${nextPRD.id}`);
    }

    res.json({
      prd: result.rows[0],
      nextQueued: nextPRD ? nextPRD.id : null,
    });
  } catch (error: any) {
    console.error('Error accepting PRD:', error);
    res.status(500).json({ error: error.message || 'Failed to accept PRD' });
  }
});

// POST /api/prds/:id/reject — human rejects, agents fix
router.post('/:id/reject', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    // Keep PRD in active status — agents will create fix tasks
    // Send a system message about the rejection
    const prdResult = await query('SELECT title, metadata FROM prds WHERE id = $1', [id]);
    if (prdResult.rows.length === 0) return res.status(404).json({ error: 'PRD not found' });

    // Update metadata with rejection reason
    await query(
      `UPDATE prds SET metadata = metadata || $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify({ rejected: true, rejectionReason: reason || 'Issues found' }), id]
    );

    // Restart QA agent to create FIX tasks
    const lifecycleManager = req.app.get('lifecycleManager');
    const repoPath = prdResult.rows[0].metadata?.repoPath;
    if (lifecycleManager && repoPath) {
      try {
        await lifecycleManager.startAgent('qa', repoPath, id);
      } catch {}
    }

    res.json({ success: true, message: 'PRD rejected — QA will create FIX tasks' });
  } catch (error: any) {
    console.error('Error rejecting PRD:', error);
    res.status(500).json({ error: error.message || 'Failed to reject PRD' });
  }
});

export default router;
