import { Router, Request, Response } from 'express';
import { exec } from 'child_process';

const router = Router();

const GH_ENV = { ...process.env, PATH: `/usr/local/bin:${process.env.PATH}` };

function run(cmd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    exec(cmd, { env: GH_ENV, timeout: 10000 }, (err, stdout, stderr) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code: err?.code || 0 });
    });
  });
}

// GET /api/settings/integrations — check status of all integrations
router.get('/integrations', async (req: Request, res: Response) => {
  const integrations: Record<string, any> = {};

  // GitHub CLI
  const ghVersion = await run('gh --version');
  const ghAuth = await run('gh auth status 2>&1');
  const ghInstalled = ghVersion.code === 0;
  const ghAuthenticated = ghAuth.code === 0;

  // Parse username from gh auth status output (format: "Logged in to github.com as USERNAME")
  let ghUser = null;
  const fullOutput = ghAuth.stdout + '\n' + ghAuth.stderr;
  const userMatch = fullOutput.match(/Logged in to github\.com as (\S+)/i);
  if (userMatch) ghUser = userMatch[1];

  integrations.github = {
    installed: ghInstalled,
    authenticated: ghAuthenticated,
    user: ghUser,
    version: ghInstalled ? ghVersion.stdout.split('\n')[0] : null,
    message: !ghInstalled
      ? 'GitHub CLI (gh) is not installed. Install it: brew install gh'
      : !ghAuthenticated
        ? 'Not authenticated. Run in your terminal: gh auth login'
        : `Authenticated as ${ghUser || 'unknown'}`,
  };

  // Claude CLI
  const claudeVersion = await run('npx -y @anthropic-ai/claude-code --version 2>&1');
  integrations.claude = {
    installed: true,
    version: claudeVersion.stdout,
  };

  // PostgreSQL
  const pgCheck = await run('pg_isready -h localhost 2>&1');
  integrations.postgres = {
    connected: pgCheck.code === 0,
    message: pgCheck.code === 0 ? 'Connected' : 'Not reachable',
  };

  res.json(integrations);
});

export default router;
