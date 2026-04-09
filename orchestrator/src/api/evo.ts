import { Router, Request, Response } from 'express';
import { pool, query } from '../db/pool';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// GET /api/evo/recommendations - list recommendations
router.get('/recommendations', async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string;
    const category = req.query.category as string;

    let sql = 'SELECT * FROM evo_recommendations WHERE 1=1';
    const values: any[] = [];
    let paramCount = 1;

    if (status) {
      sql += ` AND status = $${paramCount}`;
      values.push(status);
      paramCount++;
    }
    if (category) {
      sql += ` AND category = $${paramCount}`;
      values.push(category);
      paramCount++;
    }

    sql += ' ORDER BY created_at DESC';

    const result = await query(sql, values);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching recommendations:', error);
    res.status(500).json({ error: 'Failed to fetch recommendations' });
  }
});

// POST /api/evo/recommendations - create a recommendation
router.post('/recommendations', async (req: Request, res: Response) => {
  try {
    const { title, description, category, priority, principles_referenced } = req.body;

    if (!title || !description || !category) {
      return res.status(400).json({ error: 'title, description, and category are required' });
    }

    const id = uuidv4();
    const status = 'pending';

    const result = await query(
      `INSERT INTO evo_recommendations (id, title, description, category, status, priority, principles_referenced)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, title, description, category, status, priority || 'medium', principles_referenced || '[]']
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating recommendation:', error);
    res.status(500).json({ error: 'Failed to create recommendation' });
  }
});

// PATCH /api/evo/recommendations/:id - update status
router.patch('/recommendations/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['approved', 'rejected', 'implemented'].includes(status)) {
      return res.status(400).json({ error: 'status must be one of: approved, rejected, implemented' });
    }

    const result = await query(
      `UPDATE evo_recommendations
       SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Recommendation not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating recommendation:', error);
    res.status(500).json({ error: 'Failed to update recommendation' });
  }
});

// GET /api/evo/metrics - aggregate metrics
router.get('/metrics', async (req: Request, res: Response) => {
  try {
    // Message counts per agent
    const messageCountsResult = await query(
      `SELECT a.name, COUNT(m.id) as message_count
       FROM agents a
       LEFT JOIN messages m ON (a.id = m.from_agent OR a.id = m.to_agent)
       GROUP BY a.id, a.name
       ORDER BY a.name`
    );

    // Task completion rates per agent
    const taskCompletionResult = await query(
      `SELECT a.name,
              COUNT(CASE WHEN t.status = 'done' THEN 1 END) as completed_tasks,
              COUNT(t.id) as total_tasks,
              ROUND(100.0 * COUNT(CASE WHEN t.status = 'done' THEN 1 END) / NULLIF(COUNT(t.id), 0), 2) as completion_rate
       FROM agents a
       LEFT JOIN tasks t ON t.assigned_to = a.id
       GROUP BY a.id, a.name
       ORDER BY a.name`
    );

    // Average cycle time per agent (created_at to updated_at for done tasks)
    const cycleTimeResult = await query(
      `SELECT a.name,
              ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(t.updated_at, NOW()) - t.created_at)) / 3600)::numeric, 2) as avg_cycle_time_hours
       FROM agents a
       LEFT JOIN tasks t ON t.assigned_to = a.id
       WHERE t.status = 'done'
       GROUP BY a.id, a.name
       ORDER BY a.name`
    );

    // Defect rates (tasks marked as having issues)
    const defectRateResult = await query(
      `SELECT a.name,
              COUNT(CASE WHEN t.labels @> '["defect"]'::jsonb THEN 1 END) as defect_count,
              COUNT(t.id) as total_tasks,
              ROUND(100.0 * COUNT(CASE WHEN t.labels @> '["defect"]'::jsonb THEN 1 END) / NULLIF(COUNT(t.id), 0), 2) as defect_rate
       FROM agents a
       LEFT JOIN tasks t ON t.assigned_to = a.id
       GROUP BY a.id, a.name
       ORDER BY a.name`
    );

    const metrics = {
      message_counts: messageCountsResult.rows,
      task_completion: taskCompletionResult.rows,
      cycle_time: cycleTimeResult.rows,
      defect_rates: defectRateResult.rows,
      timestamp: new Date().toISOString()
    };

    res.json(metrics);
  } catch (error) {
    console.error('Error fetching metrics:', error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

export default router;
