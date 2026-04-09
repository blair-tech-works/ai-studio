import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { pool } from './db/pool';
import { AgentLifecycleManager } from './agents/lifecycle';
import apiRouter from './api';

// Load environment variables
dotenv.config();

// Configuration
const PORT = process.env.PORT || 3001;
const CLAUDE_CLI_PATH = process.env.CLAUDE_CLI_PATH || 'claude';
const AGENTS_CONFIG_PATH = process.env.AGENTS_CONFIG_PATH || './agents';
const TARGET_REPO_PATH = process.env.TARGET_REPO_PATH || '.';

// Initialize managers
const lifecycleManager = new AgentLifecycleManager({
  claudeCliPath: CLAUDE_CLI_PATH,
  agentsConfigPath: AGENTS_CONFIG_PATH,
  targetRepoPath: TARGET_REPO_PATH,
  pool,
});

// Express app
const app: Express = express();

// Make managers available to routes via app.locals
app.set('lifecycleManager', lifecycleManager);

// Middleware
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Mount API router
app.use('/api', apiRouter);

// Health check endpoint for orchestrator
app.get('/api/status', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date(),
    uptime: process.uptime(),
  });
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);

  try {
    // Stop all agents
    await lifecycleManager.stopAll();
    console.log('All agents stopped');

    // Close database pool
    await pool.end();
    console.log('Database connection closed');

    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
const server = app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║   AI Studio Orchestrator                   ║
║   Version: 1.0.0                           ║
╚════════════════════════════════════════════╝

Server running on http://localhost:${PORT}

Configuration:
  - Claude CLI: ${CLAUDE_CLI_PATH}
  - Agents Config: ${AGENTS_CONFIG_PATH}
  - Target Repo: ${TARGET_REPO_PATH}
  - Database: ${process.env.DATABASE_URL || 'postgresql://localhost:5432/ai_studio'}

API Endpoints (see agents.ts and other routers for full endpoint list):
  GET    /api/agents
  GET    /api/agents/:name
  PATCH  /api/agents/:name
  POST   /api/agents/:name/start
  POST   /api/agents/:name/stop
  POST   /api/agents/:name/messages

  POST   /api/prds/:prdId/publish
  POST   /api/prds/:prdId/approve
  POST   /api/prds/:prdId/override
  GET    /api/prds/:prdId/approval-status

  GET    /api/status

Type 'ctrl+c' to shutdown.
`);
});

// Export for testing
export { app, lifecycleManager };
