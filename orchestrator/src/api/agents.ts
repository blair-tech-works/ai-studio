import { Router, Request, Response } from 'express';
import { pool, query } from '../db/pool';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';

const router = Router();
const LOGS_DIR = resolve(__dirname, '..', '..', '..', 'tmp', 'logs');

// GET /api/agents - list all agents with their current status, metrics
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, name, display_name, type, status, metrics, updated_at
       FROM agents
       ORDER BY created_at DESC`
    );
    const lifecycleManager = req.app.get('lifecycleManager');
    const rows = result.rows.map((row: any) => ({
      ...row,
      connected: lifecycleManager?.isConnected(row.name) ?? false,
    }));
    res.json(rows);
  } catch (error) {
    console.error('Error fetching agents:', error);
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
});

// GET /api/agents/:name - get a single agent by name
router.get('/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const result = await query(
      `SELECT id, name, display_name, type, status, metrics, created_at, updated_at
       FROM agents
       WHERE name = $1`,
      [name]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const lifecycleManager = req.app.get('lifecycleManager');
    const row = result.rows[0];
    res.json({ ...row, connected: lifecycleManager?.isConnected(row.name) ?? false });
  } catch (error) {
    console.error('Error fetching agent:', error);
    res.status(500).json({ error: 'Failed to fetch agent' });
  }
});

// PATCH /api/agents/:name - update agent status, metrics, config
router.patch('/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const { status, metrics, type } = req.body;

    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (status !== undefined) {
      updates.push(`status = $${paramCount++}`);
      values.push(status);
    }
    if (metrics !== undefined) {
      updates.push(`metrics = $${paramCount++}`);
      values.push(metrics);
    }
    if (type !== undefined) {
      updates.push(`type = $${paramCount++}`);
      values.push(type);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(name);

    const result = await query(
      `UPDATE agents
       SET ${updates.join(', ')}
       WHERE name = $${paramCount}
       RETURNING id, name, display_name, type, status, metrics, updated_at`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating agent:', error);
    res.status(500).json({ error: 'Failed to update agent' });
  }
});

// POST /api/agents/:name/start - trigger agent start
router.post('/:name/start', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const lifecycleManager = req.app.get('lifecycleManager');

    if (!lifecycleManager) {
      return res.status(500).json({ error: 'Lifecycle manager not available' });
    }

    // Accept repoPath and prdId from body, or look up from most recent active PRD
    let repoPath = req.body?.repoPath;
    let prdId = req.body?.prdId;
    if (!repoPath || !prdId) {
      const prdResult = await query(
        `SELECT id, metadata FROM prds WHERE status IN ('review', 'approved', 'active') ORDER BY updated_at DESC LIMIT 1`
      );
      if (prdResult.rows.length > 0) {
        if (!repoPath) repoPath = prdResult.rows[0].metadata?.repoPath;
        if (!prdId) prdId = prdResult.rows[0].id;
      }
    }

    if (!repoPath || !prdId) {
      return res.status(400).json({ error: 'No active PRD found. Cannot start agent without a PRD context.' });
    }

    await lifecycleManager.startAgent(name, repoPath, prdId);
    res.json({ success: true, message: `Agent '${name}' started` });
  } catch (error) {
    console.error('Error starting agent:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/agents/:name/stop - trigger agent stop
router.post('/:name/stop', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const lifecycleManager = req.app.get('lifecycleManager');

    if (!lifecycleManager) {
      return res.status(500).json({ error: 'Lifecycle manager not available' });
    }

    await lifecycleManager.stopAgent(name);
    res.json({ success: true, message: `Agent '${name}' stopped` });
  } catch (error) {
    console.error('Error stopping agent:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/agents/:name/messages - get messages for an agent
router.get('/:name/messages', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const read = req.query.read === 'true' ? true : req.query.read === 'false' ? false : undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const offset = parseInt(req.query.offset as string) || 0;

    // Get agent id first
    const agentResult = await query(
      `SELECT id FROM agents WHERE name = $1`,
      [name]
    );

    if (agentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const agentId = agentResult.rows[0].id;

    let sql = `SELECT * FROM messages
               WHERE (from_agent = $1 OR to_agent = $1)`;
    const values: any[] = [agentId];
    let paramCount = 2;

    if (read !== undefined) {
      sql += ` AND read = $${paramCount}`;
      values.push(read);
      paramCount++;
    }

    sql += ` ORDER BY created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    values.push(limit, offset);

    const result = await query(sql, values);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching agent messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// GET /api/agents/:name/logs - tail the agent's log file
router.get('/:name/logs', (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const prdId = req.query.prdId as string;
    const maxLines = Math.min(parseInt(req.query.lines as string) || 50, 200);

    if (!existsSync(LOGS_DIR)) {
      return res.json({ lines: [], file: null, connected: false });
    }

    // Find the log file — either by prdId prefix or most recent for this agent
    let logFile: string | null = null;

    if (prdId) {
      const prefix = prdId.slice(0, 8);
      const candidate = join(LOGS_DIR, `${prefix}-${name}.log`);
      if (existsSync(candidate)) logFile = candidate;
    }

    if (!logFile) {
      // Find the most recent log file for this agent
      const files = readdirSync(LOGS_DIR)
        .filter(f => f.endsWith(`-${name}.log`) || f === `${name}.log`)
        .map(f => ({ name: f, path: join(LOGS_DIR, f), mtime: require('fs').statSync(join(LOGS_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length > 0) logFile = files[0].path;
    }

    if (!logFile || !existsSync(logFile)) {
      return res.json({ lines: [], file: null, connected: false });
    }

    // Read last N lines
    const content = readFileSync(logFile, 'utf-8');
    const allLines = content.split('\n');
    const tail = allLines.slice(-maxLines).filter(l => l.trim() !== '');

    const lifecycleManager = req.app.get('lifecycleManager');
    const connected = lifecycleManager?.isConnected(name) ?? false;

    res.json({ lines: tail, file: logFile, connected });
  } catch (error) {
    console.error('Error reading agent logs:', error);
    res.status(500).json({ error: 'Failed to read logs' });
  }
});

export default router;
