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
  // `signal` is the caller's, not the timeout's: a component that unmounts must
  // be able to abandon a retrying poll, and that abandonment must be final
  // rather than a third attempt fired at a signal nobody is listening to.
  const { timeoutMs = 10000, retries = 2, signal, ...fetchOptions } = options || {};
  let lastError: Error | null = null;

  const headers = {
    ...sessionTokenHeader(),
    ...(fetchOptions.headers as Record<string, string> | undefined),
  };

  for (let attempt = 0; attempt <= retries; attempt++) {
    // The caller may have cancelled while the previous attempt was backing off.
    if (signal?.aborted) throw lastError || abortError();

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers,
        signal: controller.signal,
      });
      if (response.ok) return response;
      // Retry on server errors (5xx)
      if (response.status >= 500 && attempt < retries) {
        lastError = new Error(`HTTP ${response.status}`);
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      return response;
    } catch (e: any) {
      lastError = e;
      // Cancelled by the caller: report it now instead of retrying work that
      // was abandoned, and let the caller decide that it is not a failure.
      if (signal?.aborted) throw e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  throw lastError || new Error('Fetch failed');
}

/** The error a cancelled read rejects with, so callers can tell it apart. */
function abortError(): Error {
  const error = new Error('The request was cancelled');
  error.name = 'AbortError';
  return error;
}
