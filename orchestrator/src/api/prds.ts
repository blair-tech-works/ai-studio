import { Router, Request, Response } from 'express';
import { pool, query } from '../db/pool';
import { v4 as uuidv4 } from 'uuid';
import { broadcast } from './events';
import { exec, execSync } from 'child_process';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join, resolve, basename } from 'path';
import { PM_GRILLING_PROMPT, PM_SYNTHESIS_PROMPT } from './prompts/pm-drafter';

const router = Router();

// Ensure temp dir exists
const TEMP_DIR = '/tmp/ai-studio-prompts';
try { mkdirSync(TEMP_DIR, { recursive: true }); } catch {}

// Helper: call claude CLI in print mode with a system prompt file
function callClaude(userPrompt: string, systemPrompt: string): Promise<string> {
  // Write system prompt and user prompt to temp files
  const sysFile = join(TEMP_DIR, `sys-${Date.now()}.txt`);
  const userFile = join(TEMP_DIR, `user-${Date.now()}.txt`);
  writeFileSync(sysFile, systemPrompt);
  writeFileSync(userFile, userPrompt);

  const model = process.env.PM_MODEL || 'sonnet';
  const cmd = `cat "${userFile}" | npx -y @anthropic-ai/claude-code -p --model ${model} --no-session-persistence --append-system-prompt-file "${sysFile}"`;

  return new Promise((resolve, reject) => {
    exec(
      cmd,
      {
        env: (() => {
          // Start with current process env, extend PATH, remove empty API key
          const env: Record<string, string> = {};
          for (const [k, v] of Object.entries(process.env)) {
            if (v !== undefined) env[k] = v;
          }
          env.PATH = `/usr/local/bin:${env.PATH || ''}`;
          // Remove ANTHROPIC_API_KEY so CLI uses OAuth auth from keychain
          delete env.ANTHROPIC_API_KEY;
          return env;
        })(),
        timeout: 120000,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        // Clean up temp files
        try { unlinkSync(sysFile); } catch {}
        try { unlinkSync(userFile); } catch {}

        if (error) {
          console.error('Claude CLI error:', { stderr, stdout, code: error.code, signal: error.signal, message: error.message });
          return reject(new Error(stderr || stdout || error.message));
        }
        resolve(stdout.trim());
      }
    );
  });
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

    res.status(201).json(result.rows[0]);
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
    res.status(502).json({ error: 'Failed to get PM response' });
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
    res.status(502).json({ error: 'Failed to synthesize PRD' });
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
          await lifecycleManager.startAgent(agent.name, repoPath);
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

    res.json(result.rows[0]);
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

export default router;
