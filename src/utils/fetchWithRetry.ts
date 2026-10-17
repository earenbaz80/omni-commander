/**
 * fetchWithRetry — wraps fetch with a timeout and exponential-backoff retries.
 * Used for all real network calls (local drive API) so transient failures
 * don't silently leave the UI without data.
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit & { timeoutMs?: number; retries?: number }
): Promise<Response> {
  const { timeoutMs = 10000, retries = 2, ...fetchOptions } = options || {};
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (response.ok) return response;
      // Retry on server errors (5xx)
      if (response.status >= 500 && attempt < retries) {
        lastError = new Error(`HTTP ${response.status}`);
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      return response;
    } catch (e: any) {
      clearTimeout(timeoutId);
      lastError = e;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
    }
  }

  throw lastError || new Error('Fetch failed');
}