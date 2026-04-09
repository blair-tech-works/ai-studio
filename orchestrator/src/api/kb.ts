import { Router, Request, Response } from 'express';
import { pool, query } from '../db/pool';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// GET /api/kb - list all KB articles
router.get('/', async (req: Request, res: Response) => {
  try {
    const tags = req.query.tags as string;
    const search = req.query.search as string;

    let sql = 'SELECT id, path, title, tags, created_at, updated_at FROM knowledge_base WHERE 1=1';
    const values: any[] = [];
    let paramCount = 1;

    if (tags) {
      sql += ` AND tags @> $${paramCount}`;
      values.push(`{${tags}}`);
      paramCount++;
    }

    if (search) {
      sql += ` AND (
        title ILIKE $${paramCount} OR
        to_tsvector('english', content) @@ plainto_tsquery('english', $${paramCount + 1})
      )`;
      values.push(`%${search}%`, search);
      paramCount += 2;
    }

    sql += ' ORDER BY updated_at DESC';

    const result = await query(sql, values);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching KB articles:', error);
    res.status(500).json({ error: 'Failed to fetch KB articles' });
  }
});

// GET /api/kb/* - get KB article by path
router.get('/*', async (req: Request, res: Response) => {
  try {
    // Extract path from wildcard match
    const path = req.params[0];

    const result = await query(
      'SELECT * FROM knowledge_base WHERE path = $1',
      [path]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'KB article not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching KB article:', error);
    res.status(500).json({ error: 'Failed to fetch KB article' });
  }
});

// PUT /api/kb/* - create or upsert KB article
router.put('/*', async (req: Request, res: Response) => {
  try {
    const path = req.params[0];
    const { title, content, tags } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: 'title and content are required' });
    }

    // Check if article exists
    const existingResult = await query(
      'SELECT id FROM knowledge_base WHERE path = $1',
      [path]
    );

    let result;
    if (existingResult.rows.length > 0) {
      // Update existing
      result = await query(
        `UPDATE knowledge_base
         SET title = $1, content = $2, tags = $3, updated_at = NOW()
         WHERE path = $4
         RETURNING *`,
        [title, content, tags || [], path]
      );
    } else {
      // Create new
      const id = uuidv4();
      result = await query(
        `INSERT INTO knowledge_base (id, path, title, content, tags)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [id, path, title, content, tags || []]
      );
    }

    res.status(existingResult.rows.length > 0 ? 200 : 201).json(result.rows[0]);
  } catch (error) {
    console.error('Error upserting KB article:', error);
    res.status(500).json({ error: 'Failed to upsert KB article' });
  }
});

// DELETE /api/kb/* - delete KB article
router.delete('/*', async (req: Request, res: Response) => {
  try {
    const path = req.params[0];

    const result = await query(
      'DELETE FROM knowledge_base WHERE path = $1 RETURNING *',
      [path]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'KB article not found' });
    }

    res.json({ message: 'KB article deleted', article: result.rows[0] });
  } catch (error) {
    console.error('Error deleting KB article:', error);
    res.status(500).json({ error: 'Failed to delete KB article' });
  }
});

export default router;
