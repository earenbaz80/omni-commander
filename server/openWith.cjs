/**
 * "Open with": what can open a file, opening it with a chosen program, and the
 * shell's own chooser.
 *
 * The registry read, the executable checks and both spawn paths belong to the
 * platform adapter. These routes keep the HTTP contract and the dry-run switch;
 * they ask the adapter for the capability instead of deciding by OS.
 */

const fs = require('fs');

const { requireCapability } = require('./platform/contract.cjs');
const { createPlatform } = require('./platform/index.cjs');

function registerOpenWithRoutes(app, deps) {
  const { platform = createPlatform(), assertSafePath, logDebug } = deps;
  const openWith = requireCapability(platform, 'openWith');

  /**
   * The Windows "Open with" chooser for one file.
   *
   * Kept apart from /api/open, which hands the file to whatever is registered:
   * this is the dialog the shell shows when there is no default, or when the user
   * wants a different program than the one that would start. The path is resolved
   * through the same safety check as every other route, so only a real file on an
   * allowed drive can be offered to a program.
   */
  app.post('/api/open-with', async (req, res) => {
    const raw = typeof (req.body || {}).path === 'string' ? req.body.path : '';
    if (!raw.trim()) return res.status(400).json({ error: 'empty-path' });
    let resolved;
    try {
      resolved = assertSafePath(raw);
    } catch {
      return res.status(400).json({ error: 'invalid-path' });
    }
    const stat = await fs.promises.stat(resolved).catch(() => null);
    if (!stat) return res.status(404).json({ error: 'not-found' });
    if (stat.isDirectory()) return res.status(400).json({ error: 'not-a-file' });

    // Same dry-run switch as the Run box, so the tests can assert the argv
    // without a dialog opening on the machine.
    if (process.env.OMNI_RUN_DRY_RUN === '1') {
      return res.json({ path: resolved, launched: ['rundll32.exe', 'shell32.dll,OpenAs_RunDLL', resolved] });
    }
    try {
      await openWith.picker(resolved);
      return res.json({ path: resolved });
    } catch (error) {
      logDebug('open-with failed', resolved, error?.message || error);
      return res.status(502).json({ error: 'launch-failed' });
    }
  });

  /**
   * The programs the Open-with submenu offers for one file.
   *
   * The shell's chooser alone was not enough: Windows will not raise its dialog
   * above the app when the process that asked for it is not in the foreground, so
   * the dialog was created behind the window and the user saw a menu item that did
   * nothing. This route lets the menu offer the same programs directly.
   */
  app.get('/api/open-with/programs', async (req, res) => {
    const raw = typeof req.query.path === 'string' ? req.query.path : '';
    if (!raw.trim()) return res.status(400).json({ error: 'empty-path' });
    let resolved;
    try {
      resolved = assertSafePath(raw);
    } catch {
      return res.status(400).json({ error: 'invalid-path' });
    }
    const stat = await fs.promises.stat(resolved).catch(() => null);
    if (!stat) return res.status(404).json({ error: 'not-found' });
    if (stat.isDirectory()) return res.status(400).json({ error: 'not-a-file' });
    if (process.env.OMNI_RUN_DRY_RUN === '1') return res.json({ path: resolved, programs: [] });
    try {
      return res.json({ path: resolved, programs: await openWith.programsFor(resolved) });
    } catch (error) {
      // A registry that cannot be read still leaves the shell chooser, so the menu
      // shows that instead of failing.
      logDebug('open-with programs failed', resolved, error?.message || error);
      return res.json({ path: resolved, programs: [] });
    }
  });

  /** Opens one file with one of the programs the submenu listed. */
  app.post('/api/open-with/app', async (req, res) => {
    const body = req.body || {};
    const raw = typeof body.path === 'string' ? body.path : '';
    const program = typeof body.program === 'string' ? body.program.trim() : '';
    if (!raw.trim()) return res.status(400).json({ error: 'empty-path' });
    // The renderer may only name an executable that exists: the path comes back
    // from this server, and anything else is refused rather than run.
    if (!program || !openWith.isProgram(program)) {
      return res.status(400).json({ error: 'invalid-program' });
    }
    let resolved;
    try {
      resolved = assertSafePath(raw);
    } catch {
      return res.status(400).json({ error: 'invalid-path' });
    }
    const stat = await fs.promises.stat(resolved).catch(() => null);
    if (!stat) return res.status(404).json({ error: 'not-found' });
    if (stat.isDirectory()) return res.status(400).json({ error: 'not-a-file' });
    if (process.env.OMNI_RUN_DRY_RUN === '1') {
      return res.json({ path: resolved, program, launched: [program, resolved] });
    }
    try {
      await openWith.launch(program, resolved);
      return res.json({ path: resolved, program });
    } catch (error) {
      logDebug('open-with program failed', program, resolved, error?.message || error);
      return res.status(502).json({ error: 'launch-failed' });
    }
  });
}

module.exports = { registerOpenWithRoutes };
