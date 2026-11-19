import { API_BASE } from './apiBase';
import { fetchWithRetry } from '../utils/fetchWithRetry';

/**
 * What the info drawer states about the share: whether one runs and where.
 *
 * The drawer names a port and nothing else, so the link list and the token the
 * share dialog needs are not copied over here.
 */
export interface SharedFolder {
  active: boolean;
  /** The port the server listens on, which it only has while serving. */
  port: number | null;
}

/**
 * The folder the local server is serving to the network right now.
 *
 * The server owns the listener and the token, so only it can say whether a share
 * is running; the drawer used to print a fixed "Blocked" for every machine. A
 * failed or incomplete read answers null, which the caller shows as unknown
 * rather than as "nothing is shared".
 */
export async function fetchShareStatus(): Promise<SharedFolder | null> {
  try {
    const response = await fetchWithRetry(`${API_BASE}/api/share`, { timeoutMs: 4000, retries: 1 });
    if (!response.ok) return null;
    const data = (await response.json()) as Partial<SharedFolder>;
    if (typeof data.active !== 'boolean') return null;
    return { active: data.active, port: typeof data.port === 'number' ? data.port : null };
  } catch {
    return null;
  }
}
