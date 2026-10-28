import { SystemStats } from '../types';
import { API_BASE } from './apiBase';
import { fetchWithRetry } from '../utils/fetchWithRetry';

/**
 * CPU and memory of the machine the local server runs on.
 *
 * Only the server can read these: a browser has no API for CPU load, and the
 * numbers used to be fixed in the drawer. Returns null when the server cannot
 * answer (web preview without the local server, or a failed read) so the caller
 * can show "unknown" instead of inventing a percentage.
 */
export async function fetchSystemStats(): Promise<SystemStats | null> {
  try {
    const response = await fetchWithRetry(`${API_BASE}/api/system/stats`, { timeoutMs: 4000, retries: 1 });
    if (!response.ok) return null;
    const data = (await response.json()) as Partial<SystemStats>;
    if (typeof data.cores !== 'number' || typeof data.ramTotalBytes !== 'number') return null;
    const ramTotalBytes = data.ramTotalBytes;
    return {
      cores: data.cores,
      // A missing or non-numeric percentage stays null rather than becoming 0%,
      // which would read as an idle machine.
      cpuPercent: typeof data.cpuPercent === 'number' ? data.cpuPercent : null,
      ramUsedBytes: Math.max(0, Number(data.ramUsedBytes) || 0),
      ramTotalBytes,
    };
  } catch {
    return null;
  }
}
