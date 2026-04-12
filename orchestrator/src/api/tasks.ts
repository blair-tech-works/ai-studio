import { Router, Request, Response } from 'express';
import { pool, query } from '../db/pool';
import { v4 as uuidv4 } from 'uuid';
import * as github from '../github/client';
import { resolve } from 'path';

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

    const task = await findTask(id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(task);
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
      // Enforce: can't mark as "done" without a PR (QA merges via /merge-pr endpoint)
      if (status === 'done') {
        const task = await findTask(id);
        if (task && !task.pr_url && !pr_url) {
          return res.status(400).json({
            error: 'Cannot mark task as done without a PR. Use POST /api/tasks/:id/create-pr first, then QA merges via POST /api/tasks/:id/merge-pr.',
          });
        }
      }
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
    const w = taskWhereClause(id);
    values.push(w.param);

    const result = await query(
      `UPDATE tasks
       SET ${updates.join(', ')}
       WHERE ${w.sql.replace('$1', `$${paramCount}`)}
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

// Helper: get repo path from the task's PRD metadata
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function taskWhereClause(id: string): { sql: string; param: string } {
  return UUID_RE.test(id)
    ? { sql: 'id = $1', param: id }
    : { sql: 'external_id = $1', param: id };
}

async function findTask(id: string) {
  const w = taskWhereClause(id);
  const result = await query(`SELECT * FROM tasks WHERE ${w.sql}`, [w.param]);
  return result.rows[0] || null;
}

async function getRepoPath(taskId: string): Promise<string | null> {
  const isUUID = UUID_RE.test(taskId);
  const result = await query(
    isUUID
      ? `SELECT p.metadata FROM tasks t JOIN prds p ON t.prd_id = p.id WHERE t.id = $1`
      : `SELECT p.metadata FROM tasks t JOIN prds p ON t.prd_id = p.id WHERE t.external_id = $1`,
    [taskId]
  );
  return result.rows[0]?.metadata?.repoPath || null;
}

// POST /api/tasks/:id/create-pr — dev agent creates a PR after pushing code
router.post('/:id/create-pr', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, body } = req.body;

    // Get task
    const task = await findTask(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const repoPath = await getRepoPath(id);
    if (!repoPath) return res.status(400).json({ error: 'No repo path found for this task' });

    const branch = task.branch_name || `agent/${req.body.agent_name || 'dev'}/${task.external_id}`;
    const prTitle = title || `${task.external_id}: ${task.title}`;
    const prBody = body || task.description || '';

    const pr = await github.createPR(repoPath, branch, prTitle, prBody);

    // Update task with PR info and status
    await query(
      `UPDATE tasks SET pr_url = $1, branch_name = $2, status = 'review', updated_at = NOW()
       WHERE id = $3`,
      [pr.url, branch, task.id]
    );

    res.json({ pr_url: pr.url, pr_number: pr.number, branch });
  } catch (error: any) {
    console.error('Error creating PR:', error);
    res.status(500).json({ error: error.message || 'Failed to create PR' });
  }
});

// POST /api/tasks/:id/merge-pr — QA agent merges an approved PR
router.post('/:id/merge-pr', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const task = await findTask(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    if (!task.pr_url) return res.status(400).json({ error: 'Task has no PR' });

    const repoPath = await getRepoPath(id);
    if (!repoPath) return res.status(400).json({ error: 'No repo path found' });

    // Extract PR number from URL
    const prMatch = task.pr_url.match(/\/pull\/(\d+)/);
    if (!prMatch) return res.status(400).json({ error: 'Cannot parse PR number from URL' });
    const prNumber = parseInt(prMatch[1]);

    await github.mergePR(repoPath, prNumber);

    // Update task status to done
    await query(
      `UPDATE tasks SET status = 'done', updated_at = NOW() WHERE id = $1`,
      [task.id]
    );

    res.json({ merged: true, pr_number: prNumber });
  } catch (error: any) {
    console.error('Error merging PR:', error);
    res.status(500).json({ error: error.message || 'Failed to merge PR' });
  }
});

// GET /api/tasks/:id/pr-diff — QA reads the PR diff for review
router.get('/:id/pr-diff', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const task = await findTask(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    if (!task.pr_url) return res.status(400).json({ error: 'Task has no PR' });

    const repoPath = await getRepoPath(id);
    if (!repoPath) return res.status(400).json({ error: 'No repo path found' });

    const prMatch = task.pr_url.match(/\/pull\/(\d+)/);
    if (!prMatch) return res.status(400).json({ error: 'Cannot parse PR number' });

    const diff = await github.getPRDiff(repoPath, parseInt(prMatch[1]));
    res.json({ diff, pr_number: parseInt(prMatch[1]) });
  } catch (error: any) {
    console.error('Error getting PR diff:', error);
    res.status(500).json({ error: error.message || 'Failed to get PR diff' });
  }
});

// POST /api/tasks/:id/pr-comment — agent posts a review comment on the PR
router.post('/:id/pr-comment', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { comment } = req.body;

    if (!comment) return res.status(400).json({ error: 'comment is required' });

    const task = await findTask(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    if (!task.pr_url) return res.status(400).json({ error: 'Task has no PR' });

    const repoPath = await getRepoPath(id);
    if (!repoPath) return res.status(400).json({ error: 'No repo path found' });

    const prMatch = task.pr_url.match(/\/pull\/(\d+)/);
    if (!prMatch) return res.status(400).json({ error: 'Cannot parse PR number' });

    await github.addPRComment(repoPath, parseInt(prMatch[1]), comment);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error adding PR comment:', error);
    res.status(500).json({ error: error.message || 'Failed to add comment' });
  }
});

// DELETE /api/tasks/:id - delete/archive task
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const w = taskWhereClause(id);
    const result = await query(
      `DELETE FROM tasks WHERE ${w.sql} RETURNING *`,
      [w.param]
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
