import { sweepWorkspaces } from './tempWorkspaces';

/**
 * Playwright's global setup and teardown, the same pass in both roles.
 *
 * Before the first test it clears the workspaces an interrupted run left; after
 * the last one it clears any this run could not delete while the app still held
 * a handle. It never fails the run: a leftover folder is worth a line, not a red
 * release, and the next run tries again.
 */
export default async function sweepLeftoverWorkspaces(): Promise<void> {
  const { removed, kept } = await sweepWorkspaces();
  if (removed.length) console.log(`[e2e] removed ${removed.length} leftover workspace(s)`);
  if (kept.length) console.log(`[e2e] ${kept.length} workspace(s) still in use, left for the next run`);
}
