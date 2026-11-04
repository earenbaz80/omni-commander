import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';

/**
 * Shared spawn/stop for the suites that run the real local drive server.
 *
 * Each suite used to hard-code a port constant, which has two failure modes and
 * both have been seen on this project:
 *
 * - two suites asking for the same port race for it, and the one that loses fails
 *   every test with "server did not start in time";
 * - the server walks forward when its preferred port is busy, so a suite probing
 *   the constant could end up probing whatever else is listening there — another
 *   suite's server, or a leftover server from an earlier run still holding a
 *   scratch folder that has already been deleted — and test against it.
 *
 * So the port comes from the OS, and the port the server is actually on is read
 * from the line it prints when it starts, never assumed. A port taken between the
 * reservation and the bind is then harmless: the helper follows the server.
 */

/** The server announces itself once it is listening; this is the only source of truth for its port. */
const ANNOUNCE_LINE = /listening on http:\/\/localhost:(\d+)/;
const DEFAULT_STARTUP_TIMEOUT_MS = 20000;
const DEFAULT_STOP_TIMEOUT_MS = 5000;

export interface TestServer {
  /** Port the server really bound, which is not necessarily the one it asked for. */
  port: number;
  /** `http://127.0.0.1:<port>`. */
  origin: string;
  /** Absolute URL for a route, e.g. `server.url('/api/fs/sendto')`. */
  url(route: string): string;
  /** Stops the process and waits for it, so no server outlives its suite. */
  stop(): Promise<void>;
}

/** Asks the OS for a free loopback port and immediately gives it back. */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      probe.close(() => (port ? resolve(port) : reject(new Error('the OS handed out no port'))));
    });
  });
}

/**
 * Asks the OS for several free ports without awaiting, for callers that cannot:
 * a Playwright config has to export one plain object, so there is nowhere to
 * await `freePort()`. A short-lived child process opens all the listeners at
 * once and prints what it was given, which is the only way to ask this
 * synchronously before the servers those ports are meant for are launched.
 *
 * The ports are handed back the moment the child exits, so they are only a
 * reservation about as strong as `freePort()`'s -- what makes it safe is that
 * both consumers are told to fail rather than share a port (`--strictPort`, and
 * no reuse), so a port stolen in that window is loud instead of silent.
 */
export function freePortsSync(count: number): number[] {
  const script = `
    const net = require('node:net');
    const servers = Array.from({ length: ${count} }, () => net.createServer());
    Promise.all(servers.map((s) => new Promise((resolve) => s.listen(0, '127.0.0.1', resolve))))
      .then(() => {
        const ports = servers.map((s) => s.address().port);
        for (const s of servers) s.close();
        process.stdout.write(JSON.stringify(ports));
      })
      .catch((error) => {
        console.error(error && error.message);
        process.exit(1);
      });
  `;
  const stdout = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  const ports: unknown = JSON.parse(String(stdout).trim());
  if (!Array.isArray(ports) || ports.length !== count || ports.some((p) => typeof p !== 'number')) {
    throw new Error(`the OS did not hand out ${count} ports: ${JSON.stringify(ports)}`);
  }
  return ports as number[];
}

const reachable = (port: number, timeoutMs = 500): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });

export interface StartServerOptions {
  /** Extra environment for the server, on top of the current one. */
  env?: Record<string, string | undefined>;
  /** Overrides the script to run, for suites that test a built variant. */
  serverPath?: string;
  startupTimeoutMs?: number;
}

/**
 * Starts `server.cjs` on a free port and resolves once it answers. The process is
 * spawned with its output piped rather than ignored: the startup line is how the
 * real port is learned, and if the server dies instead, its output is what makes
 * the failure diagnosable.
 */
export async function startServer(options: StartServerOptions = {}): Promise<TestServer> {
  const scriptPath = options.serverPath || 'server.cjs';
  const requested = await freePort();
  const child = spawn(process.execPath, [scriptPath], {
    env: { ...process.env, ...options.env, PORT: String(requested) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  const collect = (chunk: Buffer | string) => {
    output += String(chunk);
    if (output.length > 64 * 1024) output = output.slice(-32 * 1024);
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);

  const bound = await waitForAnnouncedPort(child, options.startupTimeoutMs, () => output);
  const deadline = Date.now() + 5000;
  while (!(await reachable(bound))) {
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`server announced port ${bound} but never answered there:\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  let stopped = false;
  return {
    port: bound,
    origin: `http://127.0.0.1:${bound}`,
    url: (route: string) => `http://127.0.0.1:${bound}${route}`,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      if (child.exitCode !== null || child.signalCode !== null) return;
      // A killed process writes no V8 coverage dump, and Windows has no signal to
      // deliver, so a measuring run asks the server to exit through its own hook
      // before falling back to the kill below.
      if (process.env.SERVER_COVERAGE_SHUTDOWN === '1') {
        const exitedGracefully = new Promise<void>((resolve) => child.once('exit', () => resolve()));
        await fetch(`http://127.0.0.1:${bound}/api/__coverage-shutdown`, { method: 'POST' }).catch(() => undefined);
        await Promise.race([exitedGracefully, new Promise((resolve) => setTimeout(resolve, 3000))]);
        if (child.exitCode !== null || child.signalCode !== null) return;
      }
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill();
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, DEFAULT_STOP_TIMEOUT_MS))]);
      // Still there after the grace period: take the process down for real. A
      // survivor would sit on its port and poison a later run.
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    },
  };
}

/**
 * Waits for the server's own startup line, which carries the port it bound. The
 * requested port is only used to say what was asked for when it never arrives.
 */
async function waitForAnnouncedPort(
  child: ChildProcess,
  timeoutMs: number | undefined,
  readOutput: () => string,
): Promise<number> {
  const limit = timeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  return new Promise<number>((resolve, reject) => {
    const settle = (fn: () => void) => {
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      child.stderr?.off('data', onData);
      child.off('exit', onExit);
      fn();
    };
    const onData = () => {
      const match = ANNOUNCE_LINE.exec(readOutput());
      if (match) settle(() => resolve(Number(match[1])));
    };
    const onExit = () => settle(() => reject(new Error(`server exited before listening:\n${readOutput()}`)));
    const timer = setTimeout(
      () => settle(() => reject(new Error(`server did not listen within ${limit}ms:\n${readOutput()}`))),
      limit,
    );
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', onExit);
    onData();
  });
}
