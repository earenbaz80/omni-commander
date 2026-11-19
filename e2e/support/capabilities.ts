import type { Page } from './appTest';

/** The capabilities the app's server declares for this host. */
export interface PlatformCapabilities {
  paths: boolean;
  volumes: boolean;
  cleanup: boolean;
  trash: boolean;
  openWith: boolean;
}

/**
 * What this host implements, read from the app's own server.
 *
 * A spec that walks a command has to know whether the command is drawn here:
 * the packaged run is Linux, whose adapter declares no cleanup, so a case that
 * opens the cleanup menu would fail on a control the app is right not to draw.
 * `/api/platform` is the same answer the renderer uses and needs no token.
 *
 * The packaged window is on `file://`, where a relative URL never reaches the
 * API, so the base comes from the bridge the preload exposes; in the dev run the
 * page is served by Vite and the relative path is proxied.
 */
export async function readCapabilities(page: Page): Promise<PlatformCapabilities> {
  const answered = await page.evaluate(async () => {
    const bridge = (window as unknown as { electronAPI?: { isElectron?: boolean; apiPort?: number } }).electronAPI;
    const base = bridge?.isElectron && bridge.apiPort ? `http://127.0.0.1:${bridge.apiPort}` : '';
    const response = await fetch(`${base}/api/platform`);
    if (!response.ok) return { status: response.status, capabilities: null };
    const body = (await response.json()) as { capabilities?: Record<string, unknown> };
    return { status: response.status, capabilities: body.capabilities ?? null };
  });

  const capabilities = answered.capabilities as Partial<PlatformCapabilities> | null;
  if (!capabilities || typeof capabilities.cleanup !== 'boolean') {
    throw new Error(`/api/platform answered ${answered.status} without declaring its capabilities`);
  }
  return capabilities as PlatformCapabilities;
}
