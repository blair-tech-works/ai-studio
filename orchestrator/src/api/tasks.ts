import { Router, Request, Response } from 'express';
import { pool, query } from '../db/pool';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Helper function to get next external_id
async function getNextExternalId(): Promise<string> {
  const result = await query(
    `SELECT external_id FROM tasks
     WHERE external_id LIKE 'TASK-%'
     ORDER BY CAST(SUBSTRING(external_id, 6) AS INTEGER) DESC
     LIMIT 1`
  );

  if (result.rows.length === 0) {
    return 'TASK-001';
  }

  const lastId = result.rows[0].external_id;
  const num = parseInt(lastId.split('-')[1]) + 1;
  return `TASK-${String(num).padStart(3, '0')}`;
}

// GET /api/tasks - list tasks with filtering
router.get('/', async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string;
    const assigned_to = req.query.assigned_to as string;
    const prd_id = req.query.prd_id as string;
    const priority = req.query.priority as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const offset = parseInt(req.query.offset as string) || 0;

    let sql = 'SELECT * FROM tasks WHERE 1=1';
    const values: any[] = [];
    let paramCount = 1;

    if (status) {
      sql += ` AND status = $${paramCount}`;
      values.push(status);
      paramCount++;
    }
    if (assigned_to) {
      sql += ` AND assigned_to = $${paramCount}`;
      values.push(assigned_to);
      paramCount++;
    }
    if (prd_id) {
      sql += ` AND prd_id = $${paramCount}`;
      values.push(prd_id);
      paramCount++;
    }
    if (priority) {
      sql += ` AND priority = $${paramCount}`;
      values.push(priority);
      paramCount++;
    }

    sql += ` ORDER BY created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    values.push(limit, offset);

    const result = await query(sql, values);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// POST /api/tasks - create a task
router.post('/', async (req: Request, res: Response) => {
  try {
    const { title, description, assigned_to, prd_id, priority, labels } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const id = uuidv4();
    const external_id = await getNextExternalId();
    const status = 'backlog';

    const result = await query(
      `INSERT INTO tasks (id, external_id, title, description, status, assigned_to, prd_id, priority, labels)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, external_id, title, description, status, assigned_to, prd_id, priority, labels, created_at, updated_at`,
      [id, external_id, title, description || null, status, assigned_to || null, prd_id || null, priority || 'medium', labels || []]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// GET /api/tasks/:id - get task by id (UUID or external_id)
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT * FROM tasks WHERE id = $1 OR external_id = $2`,
      [id, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching task:', error);
    res.status(500).json({ error: 'Failed to fetch task' });
  }
});

// PATCH /api/tasks/:id - update task
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, assigned_to, branch_name, pr_url, labels, priority, description } = req.body;

    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (status !== undefined) {
      updates.push(`status = $${paramCount++}`);
      values.push(status);
    }
    if (assigned_to !== undefined) {
      updates.push(`assigned_to = $${paramCount++}`);
      values.push(assigned_to);
    }
    if (branch_name !== undefined) {
      updates.push(`branch_name = $${paramCount++}`);
      values.push(branch_name);
    }
    if (pr_url !== undefined) {
      updates.push(`pr_url = $${paramCount++}`);
      values.push(pr_url);
    }
    if (labels !== undefined) {
      updates.push(`labels = $${paramCount++}`);
      values.push(labels);
    }
    if (priority !== undefined) {
      updates.push(`priority = $${paramCount++}`);
      values.push(priority);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(id, id);

    const result = await query(
      `UPDATE tasks
       SET ${updates.join(', ')}
       WHERE id = $${paramCount} OR external_id = $${paramCount + 1}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// DELETE /api/tasks/:id - delete/archive task
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await query(
      `DELETE FROM tasks
       WHERE id = $1 OR external_id = $2
       RETURNING *`,
      [id, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json({ message: 'Task deleted', task: result.rows[0] });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

export default router;
