import { Pool, PoolClient } from 'pg';

export type ApprovalStatus = 'approved' | 'questions' | 'pending' | 'overridden';

export interface ApprovalRecord {
  agentId: string;
  agentName: string;
  status: ApprovalStatus;
  comments?: string;
  submittedAt?: Date;
}

export interface ApprovalLoopResult {
  consensus: boolean;
  pending: number;
  questions: number;
  approved: number;
  overridden: number;
}

export interface ApprovalStatusSummary {
  prdId: string;
  totalAgents: number;
  approved: number;
  questions: number;
  pending: number;
  overridden: number;
  details: ApprovalRecord[];
  status: 'review' | 'approved' | 'rejected';
}

export class PRDApprovalEngine {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async publishForReview(prdId: string): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Set PRD status to 'review'
      const prdResult = await client.query(
        'UPDATE prds SET status = $1 WHERE id = $2 RETURNING title',
        ['review', prdId]
      );

      if (prdResult.rows.length === 0) {
        throw new Error(`PRD '${prdId}' not found`);
      }

      const prdTitle = prdResult.rows[0].title;

      // Get all active agents
      const agentResult = await client.query('SELECT id, name FROM agents WHERE status = $1', [
        'active',
      ]);

      // Create 'pending' approval records for all active agents
      for (const agent of agentResult.rows) {
        await client.query(
          `INSERT INTO prd_approvals (prd_id, agent_id, status, created_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (prd_id, agent_id) DO UPDATE SET status = $3`,
          [prdId, agent.id, 'pending']
        );
      }

      // Send system message to each agent
      for (const agent of agentResult.rows) {
        await client.query(
          `INSERT INTO messages (from_agent, to_agent, content, type, read)
           VALUES (NULL, $1, $2, $3, false)`,
          [
            agent.id,
            `New PRD published for review: ${prdTitle}. Please review and approve or submit questions.`,
            'system',
          ]
        );
      }

      await client.query('COMMIT');
      console.log(`PRD '${prdId}' published for review to ${agentResult.rows.length} agents`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`Failed to publish PRD '${prdId}' for review:`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  async submitApproval(
    prdId: string,
    agentId: string,
    status: 'approved' | 'questions',
    comments?: string
  ): Promise<ApprovalLoopResult> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Update the approval record
      await client.query(
        `UPDATE prd_approvals
         SET status = $1, comments = $2, updated_at = NOW()
         WHERE prd_id = $3 AND agent_id = $4`,
        [status, comments || null, prdId, agentId]
      );

      // If status is 'questions', send message to PM
      if (status === 'questions' && comments) {
        const agentResult = await client.query('SELECT name FROM agents WHERE id = $1', [agentId]);

        if (agentResult.rows.length > 0) {
          const agentName = agentResult.rows[0].name;
          // Send message from agent to PM (null recipient means system/PM)
          await client.query(
            `INSERT INTO messages (from_agent, to_agent, content, type, read)
             VALUES ($1, NULL, $2, $3, false)`,
            [
              agentId,
              `Questions on PRD '${prdId}' from ${agentName}: ${comments}`,
              'question',
            ]
          );
        }
      }

      // Check if consensus is reached
      const consensus = await this._checkConsensusInternal(client, prdId);

      // Get current approval counts
      const countResult = await client.query(
        `SELECT
           COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved,
           COUNT(CASE WHEN status = 'questions' THEN 1 END) as questions,
           COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
           COUNT(CASE WHEN status = 'overridden' THEN 1 END) as overridden
         FROM prd_approvals
         WHERE prd_id = $1`,
        [prdId]
      );

      const counts = countResult.rows[0];

      if (consensus) {
        // Set PRD status to 'approved'
        await client.query('UPDATE prds SET status = $1 WHERE id = $2', ['approved', prdId]);

        // Send system message to all agents
        const agentResult = await client.query('SELECT id FROM agents WHERE status = $1', [
          'active',
        ]);

        for (const agent of agentResult.rows) {
          await client.query(
            `INSERT INTO messages (from_agent, to_agent, content, type, read)
             VALUES (NULL, $1, $2, $3, false)`,
            [agent.id, `PRD consensus reached. All agents have approved.`, 'system']
          );
        }
      }

      await client.query('COMMIT');

      return {
        consensus,
        pending: parseInt(counts.pending),
        questions: parseInt(counts.questions),
        approved: parseInt(counts.approved),
        overridden: parseInt(counts.overridden),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`Failed to submit approval for PRD '${prdId}':`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  async humanOverride(prdId: string): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Set all remaining pending/questions approvals to 'overridden'
      await client.query(
        `UPDATE prd_approvals
         SET status = $1, updated_at = NOW()
         WHERE prd_id = $2 AND status IN ($3, $4)`,
        ['overridden', prdId, 'pending', 'questions']
      );

      // Set PRD status to 'approved'
      await client.query('UPDATE prds SET status = $1 WHERE id = $2', ['approved', prdId]);

      // Send system message to all agents
      const agentResult = await client.query('SELECT id FROM agents WHERE status = $1', [
        'active',
      ]);

      for (const agent of agentResult.rows) {
        await client.query(
          `INSERT INTO messages (from_agent, to_agent, content, type, read)
           VALUES (NULL, $1, $2, $3, false)`,
          [
            agent.id,
            'Human has approved the PRD. Agents with outstanding questions should use their best judgment.',
            'system',
          ]
        );
      }

      await client.query('COMMIT');
      console.log(`Human override applied to PRD '${prdId}'`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`Failed to apply human override to PRD '${prdId}':`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getApprovalStatus(prdId: string): Promise<ApprovalStatusSummary> {
    try {
      const result = await this.pool.query(
        `SELECT
           p.id as prd_id,
           p.status as prd_status,
           pa.agent_id,
           a.name as agent_name,
           pa.status as approval_status,
           pa.comments,
           pa.updated_at,
           COUNT(*) OVER() as total_agents
         FROM prds p
         LEFT JOIN prd_approvals pa ON p.id = pa.prd_id
         LEFT JOIN agents a ON pa.agent_id = a.id
         WHERE p.id = $1
         ORDER BY a.name ASC`,
        [prdId]
      );

      if (result.rows.length === 0) {
        throw new Error(`PRD '${prdId}' not found`);
      }

      let approved = 0;
      let questions = 0;
      let pending = 0;
      let overridden = 0;
      const details: ApprovalRecord[] = [];

      for (const row of result.rows) {
        if (row.agent_id) {
          const status = row.approval_status as ApprovalStatus;

          if (status === 'approved') approved++;
          else if (status === 'questions') questions++;
          else if (status === 'pending') pending++;
          else if (status === 'overridden') overridden++;

          details.push({
            agentId: row.agent_id,
            agentName: row.agent_name,
            status,
            comments: row.comments,
            submittedAt: row.updated_at ? new Date(row.updated_at) : undefined,
          });
        }
      }

      return {
        prdId,
        totalAgents: parseInt(result.rows[0].total_agents) || 0,
        approved,
        questions,
        pending,
        overridden,
        details,
        status: result.rows[0].prd_status,
      };
    } catch (error) {
      console.error(`Failed to get approval status for PRD '${prdId}':`, error);
      throw error;
    }
  }

  async checkConsensus(prdId: string): Promise<boolean> {
    const client = await this.pool.connect();

    try {
      return await this._checkConsensusInternal(client, prdId);
    } finally {
      client.release();
    }
  }

  private async _checkConsensusInternal(client: PoolClient, prdId: string): Promise<boolean> {
    // Consensus is reached when all agents have either approved or been overridden
    const result = await client.query(
      `SELECT COUNT(*) as total, COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved
       FROM prd_approvals
       WHERE prd_id = $1`,
      [prdId]
    );

    const total = parseInt(result.rows[0].total);
    const approved = parseInt(result.rows[0].approved);

    // Consensus if all agents approved
    return total > 0 && approved === total;
  }
}
