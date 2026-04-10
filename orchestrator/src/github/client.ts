import { exec } from 'child_process';

const GH_ENV = { ...process.env, PATH: `/usr/local/bin:${process.env.PATH}` };

function run(cmd: string, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { env: GH_ENV, cwd, timeout: 60000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        console.error(`gh error: ${stderr || err.message}`);
        return reject(new Error(stderr || err.message));
      }
      resolve(stdout.trim());
    });
  });
}

export async function createPR(repoPath: string, branch: string, title: string, body: string): Promise<{ url: string; number: number }> {
  // Push the branch first
  await run(`git push -u origin "${branch}"`, repoPath);

  // Create PR via gh CLI
  const result = await run(
    `gh pr create --base main --head "${branch}" --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}" --json url,number`,
    repoPath
  );

  try {
    return JSON.parse(result);
  } catch {
    // gh might return just the URL
    const url = result.trim();
    const numMatch = url.match(/\/pull\/(\d+)/);
    return { url, number: numMatch ? parseInt(numMatch[1]) : 0 };
  }
}

export async function mergePR(repoPath: string, prNumber: number): Promise<void> {
  await run(`gh pr merge ${prNumber} --merge --delete-branch`, repoPath);
}

export async function getPRDiff(repoPath: string, prNumber: number): Promise<string> {
  return run(`gh pr diff ${prNumber}`, repoPath);
}

export async function getPRComments(repoPath: string, prNumber: number): Promise<Array<{ author: string; body: string; createdAt: string }>> {
  const result = await run(`gh pr view ${prNumber} --json comments`, repoPath);
  try {
    const parsed = JSON.parse(result);
    return (parsed.comments || []).map((c: any) => ({
      author: c.author?.login || 'unknown',
      body: c.body,
      createdAt: c.createdAt,
    }));
  } catch {
    return [];
  }
}

export async function addPRComment(repoPath: string, prNumber: number, body: string): Promise<void> {
  await run(`gh pr comment ${prNumber} --body "${body.replace(/"/g, '\\"')}"`, repoPath);
}

export async function getPRStatus(repoPath: string, prNumber: number): Promise<{ state: string; mergeable: string; reviewDecision: string }> {
  const result = await run(`gh pr view ${prNumber} --json state,mergeable,reviewDecision`, repoPath);
  try {
    return JSON.parse(result);
  } catch {
    return { state: 'unknown', mergeable: 'unknown', reviewDecision: 'unknown' };
  }
}
