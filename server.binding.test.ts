// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'node:net';
import os from 'node:os';
import { startServer, type TestServer } from '@/scripts/serverHarness';

/**
 * The local drive API exposes the whole filesystem (listings of any path).
 * It must only be reachable over loopback, never from the LAN.
 */
let server: TestServer;

const tryConnect = (host: string, port: number, timeoutMs = 1000): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });

const lanIPv4 = (): string | null => {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs || []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return null;
};

beforeAll(async () => {
  server = await startServer();
}, 30000);

afterAll(async () => {
  await server.stop();
});

describe('local API binding', () => {
  it('is reachable on loopback', async () => {
    expect(await tryConnect('127.0.0.1', server.port)).toBe(true);
  });

  it('is NOT reachable from a non-loopback interface', async () => {
    const ip = lanIPv4();
    if (!ip) {
      // No external interface on this machine; nothing to assert.
      return;
    }
    expect(await tryConnect(ip, server.port)).toBe(false);
  });
});
