export type DeveloperWorktree = { path: string; branch: string; head: string; locked: boolean }
export type DeveloperTask = { id: string; root: string; name: string; command: string; state: 'running' | 'passed' | 'failed' | 'stopped'; startedAt: string; finishedAt?: string; exitCode?: number | null; output: string; urls: string[]; sourceRevision: string; stale: boolean }
export type DeveloperWorkspace = { root: string; gitRoot: string | null; branch: string | null; worktrees: DeveloperWorktree[]; scripts: Record<string, string>; runner: 'bun' | 'pnpm' | 'yarn' | 'npm'; tasks: DeveloperTask[] }
export type ChatWorkspaceChoice = { kind: 'new-worktree'; branch?: string } | { kind: 'existing-worktree'; path: string }
