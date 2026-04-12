import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export class WorktreeManager {
  private targetRepoPath: string;
  private worktreeBaseDir: string;

  constructor(targetRepoPath: string) {
    this.targetRepoPath = targetRepoPath;
    // Store worktrees inside the target repo under .worktrees/
    this.worktreeBaseDir = path.join(targetRepoPath, '.worktrees');

    if (!fs.existsSync(this.worktreeBaseDir)) {
      fs.mkdirSync(this.worktreeBaseDir, { recursive: true });
    }
  }

  async createWorktree(agentName: string, baseBranch?: string): Promise<string> {
    const worktreePath = path.join(this.worktreeBaseDir, agentName);
    const branchName = `worktree/${agentName}`;
    const baseRef = baseBranch || this._getDefaultBranch();

    // Clean up any stale worktree registrations
    try {
      execSync(`git -C "${this.targetRepoPath}" worktree prune`, { stdio: 'pipe' });
    } catch {}

    // Remove existing worktree if it exists
    if (fs.existsSync(worktreePath)) {
      try {
        execSync(`git -C "${this.targetRepoPath}" worktree remove --force "${worktreePath}"`, { stdio: 'pipe' });
      } catch {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
    }

    // Delete the branch if it exists (leftover from previous run)
    try {
      execSync(`git -C "${this.targetRepoPath}" branch -D "${branchName}"`, { stdio: 'pipe' });
    } catch {}

    // Create worktree with a new branch
    try {
      execSync(
        `git -C "${this.targetRepoPath}" worktree add -b "${branchName}" "${worktreePath}" "${baseRef}"`,
        { stdio: 'pipe' }
      );
    } catch (e: any) {
      // Try without -b if branch creation fails
      try {
        execSync(`git -C "${this.targetRepoPath}" worktree add "${worktreePath}" "${baseRef}"`, { stdio: 'pipe' });
      } catch (e2: any) {
        throw new Error(`Failed to create worktree for '${agentName}': ${e2.message}`);
      }
    }

    // Inject pre-push hook to block direct pushes to main/master
    this._installPushGuard(worktreePath);

    return worktreePath;
  }

  /**
   * Install a git pre-push hook that rejects pushes to main/master.
   * Agents must use the PR endpoints instead.
   */
  private _installPushGuard(worktreePath: string): void {
    // In worktrees, .git is a file (not a directory) pointing to the main repo.
    // We need to find the actual git dir to install hooks.
    const dotGit = path.join(worktreePath, '.git');
    let hooksDir: string;

    try {
      const stat = fs.statSync(dotGit);
      if (stat.isFile()) {
        // Worktree — .git is a file like "gitdir: /path/to/main/.git/worktrees/name"
        const content = fs.readFileSync(dotGit, 'utf-8').trim();
        const gitDir = content.replace('gitdir: ', '');
        hooksDir = path.join(gitDir, 'hooks');
      } else {
        hooksDir = path.join(dotGit, 'hooks');
      }
    } catch {
      return; // Can't determine git dir, skip hook installation
    }

    if (!fs.existsSync(hooksDir)) {
      fs.mkdirSync(hooksDir, { recursive: true });
    }

    const hookScript = `#!/bin/sh
# AI Studio: Block direct pushes to main/master.
# Agents must create PRs via the orchestrator API.

while read local_ref local_sha remote_ref remote_sha
do
  branch=$(echo "$remote_ref" | sed 's|refs/heads/||')
  if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
    echo "ERROR: Direct push to '$branch' is blocked."
    echo "Use the AI Studio PR workflow: POST /api/tasks/<id>/create-pr"
    exit 1
  fi
done
exit 0
`;

    const hookPath = path.join(hooksDir, 'pre-push');
    fs.writeFileSync(hookPath, hookScript, { mode: 0o755 });
  }

  async removeWorktree(agentName: string): Promise<void> {
    const worktreePath = path.join(this.worktreeBaseDir, agentName);

    if (!fs.existsSync(worktreePath)) return;

    try {
      execSync(`git -C "${this.targetRepoPath}" worktree remove --force "${worktreePath}"`, { stdio: 'pipe' });
    } catch {}

    if (fs.existsSync(worktreePath)) {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }

    // Clean up branch
    try {
      execSync(`git -C "${this.targetRepoPath}" branch -D "worktree/${agentName}"`, { stdio: 'pipe' });
    } catch {}
  }

  private _getDefaultBranch(): string {
    try {
      const result = execSync(`git -C "${this.targetRepoPath}" symbolic-ref --short HEAD`, {
        stdio: 'pipe',
        encoding: 'utf-8',
      });
      return result.trim();
    } catch {
      return 'main';
    }
  }
}
