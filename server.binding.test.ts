// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';

/**
 * The local drive API exposes the whole filesystem (listings of any path).
 * It must only be reachable over loopback, never from the LAN.
 */
const PORT = 3999;
let child: ChildProcess | null = null;

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
  child = spawn(process.execPath, ['server.cjs'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  const start = Date.now();
  while (Date.now() - start < 10000) {
    if (await tryConnect('127.0.0.1', PORT)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not start in time');
}, 20000);

afterAll(() => {
  child?.kill();
});

describe('local API binding', () => {
  it('is reachable on loopback', async () => {
    expect(await tryConnect('127.0.0.1', PORT)).toBe(true);
  });

  it('is NOT reachable from a non-loopback interface', async () => {
    const ip = lanIPv4();
    if (!ip) {
      // No external interface on this machine; nothing to assert.
      return;
    }
    expect(await tryConnect(ip, PORT)).toBe(false);
  });
});
