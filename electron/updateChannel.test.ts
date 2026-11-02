// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

/**
 * Beta builds are published as GitHub prereleases, which the stable feed never
 * reads. The file that records the choice is small and hand-editable, so what
 * matters here is that nothing but a deliberate `beta` switches the feed: a
 * test build reaching a stable copy is the failure worth designing against.
 */
const require = createRequire(import.meta.url);
const { normalizeChannel, readUpdateChannel } = require('./updateChannel.cjs') as {
  normalizeChannel: (raw: unknown) => 'stable' | 'beta';
  readUpdateChannel: (options?: { channelPath?: string; readFile?: (file: string) => string }) => 'stable' | 'beta';
};

const CHANNEL_PATH = 'C:\\Users\\someone\\AppData\\Roaming\\omnicommander-pro\\update-channel';

describe('canal de actualización', () => {
  it('solo beta cambia de canal', () => {
    expect(normalizeChannel('beta')).toBe('beta');
    expect(normalizeChannel(' BETA\n')).toBe('beta');
  });

  it('cualquier otra cosa es el canal estable', () => {
    expect(normalizeChannel('stable')).toBe('stable');
    expect(normalizeChannel('latest')).toBe('stable');
    expect(normalizeChannel('')).toBe('stable');
    expect(normalizeChannel(null)).toBe('stable');
    expect(normalizeChannel(42)).toBe('stable');
    // A half-written file must not become an opt-in.
    expect(normalizeChannel('betaa')).toBe('stable');
  });

  it('lee el canal del fichero que escribe la interfaz', () => {
    expect(readUpdateChannel({ channelPath: CHANNEL_PATH, readFile: () => 'beta\n' })).toBe('beta');
  });

  it('sin fichero, o si no se puede leer, se queda en estable', () => {
    const refusing = () => {
      throw new Error('ENOENT');
    };
    expect(readUpdateChannel({ channelPath: CHANNEL_PATH, readFile: refusing })).toBe('stable');
    expect(readUpdateChannel({})).toBe('stable');
  });
});
