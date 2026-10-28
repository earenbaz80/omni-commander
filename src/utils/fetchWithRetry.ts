/**
 * fetchWithRetry — wraps fetch with a timeout and exponential-backoff retries.
 * Used for all real network calls (local drive API) so transient failures
 * don't silently leave the UI without data.
 */

/**
 * The embedded server requires a per-launch session token on every mutating
 * request and on the GETs that describe the disk. The Electron main process
 * generates it and preload.cjs exposes it on the bridge, so attaching it here
 * covers every renderer call: no caller has to remember to send it and none can
 * forget. Outside Electron the bridge is absent (dev web / tests) and the server
 * runs without a token, so no header is added.
 */
export function sessionTokenHeader(): Record<string, string> {
  const bridge = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;
  const token = bridge?.apiToken;
  return token ? { 'x-omni-token': String(token) } : {};
}

export async function fetchWithRetry(
  url: string,
  options?: RequestInit & { timeoutMs?: number; retries?: number },
): Promise<Response> {
  const { timeoutMs = 10000, retries = 2, ...fetchOptions } = options || {};
  let lastError: Error | null = null;

  const headers = {
    ...sessionTokenHeader(),
    ...(fetchOptions.headers as Record<string, string> | undefined),
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (response.ok) return response;
      // Retry on server errors (5xx)
      if (response.status >= 500 && attempt < retries) {
        lastError = new Error(`HTTP ${response.status}`);
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      return response;
    } catch (e: any) {
      clearTimeout(timeoutId);
      lastError = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
    }
  }

  throw lastError || new Error('Fetch failed');
}
