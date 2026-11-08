import { defineConfig, devices } from '@playwright/test';
import { freePortsSync } from './scripts/serverHarness';

/**
 * The e2e suite starts its own copy of the app, and it used to do so on the
 * documented ports (UI on 3000, API on 3001) while reusing whatever already
 * answered there. On a machine where something else lives on those ports --
 * another app, a dev server from a second checkout, a server left behind by an
 * earlier run -- the specs silently tested that other thing: the smoke test
 * failed on a "Cerrar pestaña" button belonging to an unrelated application.
 *
 * So the ports are asked of the OS and the URLs come from them, and the servers
 * are launched through `node` directly rather than through `npm run`, which
 * leaves the process Playwright has to stop one level shallower. Pinning a port
 * through the environment on purpose still wins, and only then is an existing
 * server reused -- that is the documented way to point the suite at one you are
 * already running.
 */
const pinnedUiPort = Number(process.env.E2E_UI_PORT || 0);
const pinnedApiPort = Number(process.env.OMNI_API_PORT || 0);

/**
 * The ports have to be the same in every load of this file, and Playwright loads
 * it more than once: once in the run's own process, which is where the servers
 * below are launched from, and again in each worker process, which is where
 * `use.baseURL` comes from. Reserving a fresh pair per load splits those two --
 * observed as one run where the app was on 3415 and the specs knocked on 9380 and
 * 11779. So the first load reserves the pair and records it in the environment,
 * which Playwright passes on to the workers and to the servers it spawns; later
 * loads read it back and agree.
 */
function reservedPorts(): [number, number] {
  const remembered = (process.env.E2E_RESERVED_PORTS || '').split(',').map(Number);
  if (remembered.length === 2 && remembered.every((port) => port > 0)) {
    return [remembered[0], remembered[1]];
  }
  const reserved = freePortsSync(2) as [number, number];
  process.env.E2E_RESERVED_PORTS = `${reserved[0]},${reserved[1]}`;
  return reserved;
}

const [freeUiPort, freeApiPort] = reservedPorts();
const uiPort = pinnedUiPort || freeUiPort;
const apiPort = pinnedApiPort || freeApiPort;

export default defineConfig({
  testDir: './e2e',
  // The app, the Vite dev server and the backend starve when several Chromium
  // contexts load at once, which made the readiness gates time out. Serial
  // execution keeps this small suite deterministic and reliable.
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  // The suite's workspaces are thrown away by each spec, but a run stopped with
  // Ctrl+C never reaches that code and a folder the app still holds a handle in
  // survives it. Both cases accumulated folders in the temp directory, so the
  // run sweeps them up front and again at the end.
  globalSetup: './e2e/support/workspaceSweep.ts',
  globalTeardown: './e2e/support/workspaceSweep.ts',
  // A single refusal in a 51-case interface suite used to turn the release red and
  // take the packaging job down with it. One retry in CI keeps a broken spec red --
  // both attempts fail, so nothing is hidden -- while a transient one costs a retry
  // instead of a release. Locally there are no retries on purpose: a flake is
  // something to see, not to paper over.
  retries: process.env.CI ? 1 : 0,
  use: {
    // Everything here addresses the app as 127.0.0.1, never as `localhost`.
    //
    // `localhost` resolves to ::1 first both here and on the Windows runners, and
    // then Chromium and the dev server can disagree about the family the server is
    // on: a connection rides ::1, the next falls back to 127.0.0.1, and nothing
    // answers there. That is how the 1.0.35 tag failed -- one goto got
    // ERR_CONNECTION_REFUSED at a URL whose server was answering a second before
    // and a second after -- so the address is pinned once, for server and browser.
    baseURL: `http://127.0.0.1:${uiPort}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      // Same command as `npm run dev`, on a port nothing else is on. `--strictPort`
      // turns a stolen port into a loud failure instead of a second dev server on
      // a port the specs are not looking at.
      command: `node node_modules/vite/bin/vite.js --port=${uiPort} --strictPort --host=127.0.0.1`,
      url: `http://127.0.0.1:${uiPort}`,
      timeout: 180000,
      reuseExistingServer: Boolean(pinnedUiPort),
      // Vite proxies /api to this port, so the app under test talks to the API
      // started below and not to whatever is sitting on the default one.
      env: { OMNI_API_PORT: String(apiPort) },
    },
    {
      command: `node --env-file-if-exists=.env server.cjs`,
      url: `http://127.0.0.1:${apiPort}/api/drives`,
      timeout: 60000,
      reuseExistingServer: Boolean(pinnedApiPort),
      env: { PORT: String(apiPort) },
    },
  ],
});
