import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * The throwaway folders the end-to-end suite works in.
 *
 * Every spec already removed its own workspace when the test ended, and folders
 * still piled up in the machine's temp directory anyway:
 *
 * - the removal runs at the end of a test, so a suite stopped with Ctrl+C -- or
 *   one whose browser crashed -- never reaches it;
 * - on Windows the app under test can still hold a handle inside the folder a
 *   moment after the test finished, and the first `rm` fails with `EBUSY`.
 *
 * So the removal retries, and a run clears whatever an earlier run left behind
 * before its first test and again after its last one.
 */

/** The suite's own prefixes: narrow enough never to touch another tool's folder. */
const WORKSPACE_PREFIXES = ['omni-e2e-', 'omni-a11y-'];

/** Waits before each attempt; the last one is long enough for a closing handle. */
const RETRY_DELAYS_MS = [0, 50, 150, 400, 800];

/** A removal that failed for a reason waiting can fix. */
function isBusy(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY' || code === 'EACCES';
}

/**
 * Removes one workspace, waiting out the handle the app still has open on it.
 * A folder that was never created is not an error: the cleanup runs even when
 * the setup failed.
 */
export async function removeWorkspace(dir: string | undefined): Promise<void> {
  if (!dir) return;
  let lastError: unknown;
  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!isBusy(error)) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`could not remove ${dir}`);
}

export interface SweepResult {
  /** Workspaces this sweep took away. */
  removed: string[];
  /** Workspaces a live process still holds; the next run tries again. */
  kept: string[];
}

/**
 * Deletes the workspaces earlier runs could not take away. It only looks at the
 * two prefixes above, so a unit test's folder sitting beside them is untouched.
 */
export async function sweepWorkspaces(root: string = os.tmpdir()): Promise<SweepResult> {
  const removed: string[] = [];
  const kept: string[] = [];
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    // No temp directory to sweep is not a failure of the suite.
    return { removed, kept };
  }
  for (const name of entries) {
    if (!WORKSPACE_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    const dir = path.join(root, name);
    try {
      if (!(await fs.stat(dir)).isDirectory()) continue;
    } catch {
      // Gone between the listing and the probe: nothing left to do about it.
      continue;
    }
    try {
      await removeWorkspace(dir);
      removed.push(dir);
    } catch {
      kept.push(dir);
    }
  }
  return { removed, kept };
}
