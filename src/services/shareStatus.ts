import { ShareStatus } from '../types';
import { API_BASE } from './apiBase';
import { fetchWithRetry } from '../utils/fetchWithRetry';

/**
 * The folder the local server is serving to the network right now.
 *
 * The server owns the listener and the token, so only it can say whether a share
 * is running; the drawer used to print a fixed "Blocked" for every machine. A
 * failed or incomplete read answers null, which the caller shows as unknown
 * rather than as "nothing is shared".
 */
export async function fetchShareStatus(): Promise<ShareStatus | null> {
  try {
    const response = await fetchWithRetry(`${API_BASE}/api/share`, { timeoutMs: 4000, retries: 1 });
    if (!response.ok) return null;
    const data = (await response.json()) as Partial<ShareStatus>;
    if (typeof data.active !== 'boolean') return null;
    return {
      active: data.active,
      folder: typeof data.folder === 'string' ? data.folder : null,
      port: typeof data.port === 'number' ? data.port : null,
      token: typeof data.token === 'string' ? data.token : null,
      startedAt: typeof data.startedAt === 'string' ? data.startedAt : null,
      urls: Array.isArray(data.urls) ? data.urls.filter((url): url is string => typeof url === 'string') : [],
    };
  } catch {
    return null;
  }
}
