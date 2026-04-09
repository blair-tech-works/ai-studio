import { Router, Request, Response } from 'express';
import { pool, query } from '../db/pool';
import { v4 as uuidv4 } from 'uuid';
import { broadcast } from './events';

const router = Router();

// GET /api/messages - list messages with filtering
router.get('/', async (req: Request, res: Response) => {
  try {
    const from_agent = req.query.from_agent as string;
    const to_agent = req.query.to_agent as string;
    const task_id = req.query.task_id as string;
    const type = req.query.type as string;
    const read = req.query.read === 'true' ? true : req.query.read === 'false' ? false : undefined;
    const since = req.query.since as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const offset = parseInt(req.query.offset as string) || 0;

    let sql = 'SELECT * FROM messages WHERE 1=1';
    const values: any[] = [];
    let paramCount = 1;

    if (from_agent) {
      sql += ` AND from_agent = (SELECT id FROM agents WHERE name = $${paramCount})`;
      values.push(from_agent);
      paramCount++;
    }
    if (to_agent) {
      sql += ` AND to_agent = (SELECT id FROM agents WHERE name = $${paramCount})`;
      values.push(to_agent);
      paramCount++;
    }
    if (task_id) {
      sql += ` AND task_id = $${paramCount}`;
      values.push(task_id);
      paramCount++;
    }
    if (type) {
      sql += ` AND type = $${paramCount}`;
      values.push(type);
      paramCount++;
    }
    if (read !== undefined) {
      sql += ` AND read = $${paramCount}`;
      values.push(read);
      paramCount++;
    }
    if (since) {
      sql += ` AND created_at > $${paramCount}`;
      values.push(since);
      paramCount++;
    }

    sql += ` ORDER BY created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    values.push(limit, offset);

    const result = await query(sql, values);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// POST /api/messages - send a message
router.post('/', async (req: Request, res: Response) => {
  try {
    const { from_agent, to_agent, content, type, task_id, metadata } = req.body;

    if (!from_agent || !to_agent || !content) {
      return res.status(400).json({ error: 'from_agent, to_agent, and content are required' });
    }

    // Resolve agent names to UUIDs
    const fromAgentResult = await query(
      'SELECT id FROM agents WHERE name = $1',
      [from_agent]
    );
    const toAgentResult = await query(
      'SELECT id FROM agents WHERE name = $1',
      [to_agent]
    );

    if (fromAgentResult.rows.length === 0 || toAgentResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid agent name(s)' });
    }

    const id = uuidv4();
    const fromAgentId = fromAgentResult.rows[0].id;
    const toAgentId = toAgentResult.rows[0].id;

    const result = await query(
      `INSERT INTO messages (id, from_agent, to_agent, content, type, task_id, metadata, read)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false)
       RETURNING *`,
      [id, fromAgentId, toAgentId, content, type || 'message', task_id || null, metadata || null]
    );

    const message = result.rows[0];

    // Broadcast event
    broadcast('message', message);

    res.status(201).json(message);
  } catch (error) {
    console.error('Error creating message:', error);
    res.status(500).json({ error: 'Failed to create message' });
  }
});

// GET /api/messages/:id - get single message
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      'SELECT * FROM messages WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching message:', error);
    res.status(500).json({ error: 'Failed to fetch message' });
  }
});

// PATCH /api/messages/:id - mark as read
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { read } = req.body;

    if (read === undefined) {
      return res.status(400).json({ error: 'read field is required' });
    }

    const result = await query(
      `UPDATE messages
       SET read = $1
       WHERE id = $2
       RETURNING *`,
      [read, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating message:', error);
    res.status(500).json({ error: 'Failed to update message' });
  }
});

// GET /api/messages/stream - SSE endpoint for real-time message streaming
router.get('/stream', (req: Request, res: Response) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Send initial comment
  res.write(': SSE stream initialized\n\n');

  let lastCheck = new Date();
  const pollInterval = 1000; // 1 second

  const interval = setInterval(async () => {
    try {
      const now = new Date();
      const result = await query(
        'SELECT * FROM messages WHERE created_at > $1 ORDER BY created_at ASC',
        [lastCheck]
      );

      if (result.rows.length > 0) {
        result.rows.forEach((message: any) => {
          res.write(`event: message\n`);
          res.write(`data: ${JSON.stringify(message)}\n\n`);
        });
        lastCheck = now;
      }
    } catch (error) {
      console.error('Error polling messages:', error);
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ error: 'Failed to poll messages' })}\n\n`);
    }
  }, pollInterval);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(interval);
    res.end();
  });
});

export default router;
