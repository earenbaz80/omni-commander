/**
 * "Open with": what can open a file, and opening it with that program.
 *
 * Enumerating the programs Windows has registered for an extension means
 * reading the registry through PowerShell, which no other route does, so the
 * whole conversation with the shell lives here. Registered as a function: the
 * app, the path guard and the debug log are handed in.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
function registerOpenWithRoutes(app, deps) {
  const { assertSafePath, isAbsoluteLocalPath, logDebug } = deps;

  const PROGRAM_EXTENSIONS = new Set(['.exe', '.com']);

  function isLaunchableProgramFile(file) {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  }

  /**
   * The programs Windows has registered for one extension, as a PowerShell script
   * that prints JSON. It reads what Explorer itself reads: the extension's default
   * handler, the ProgIDs that claim it, and the per-user list of programs used
   * before. Only the command's executable is kept: the command template itself is
   * parsed here, never run, so what gets launched is always [exe, file].
   */
  function openWithProgramsScript(ext) {
    return `
$ErrorActionPreference = 'SilentlyContinue'
$ext = '${ext}'
$exes = New-Object System.Collections.Generic.List[string]
function Add-Exe($command) {
  if (-not $command) { return }
  $text = ([string]$command).Trim()
  if ($text.StartsWith('"')) {
    $end = $text.IndexOf('"', 1)
    if ($end -gt 1) { $exes.Add($text.Substring(1, $end - 1)) }
  } else {
    $exes.Add((($text -split ' ')[0]))
  }
}
$progids = New-Object System.Collections.Generic.List[string]
$extKey = Get-Item ('Registry::HKEY_CLASSES_ROOT\\' + $ext)
if ($extKey) { $def = [string]$extKey.GetValue(''); if ($def) { $progids.Add($def) } }
foreach ($key in @(('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\' + $ext + '\\OpenWithProgids'), ('Registry::HKEY_CLASSES_ROOT\\' + $ext + '\\OpenWithProgids'))) {
  $k = Get-Item $key
  if ($k) { foreach ($n in $k.GetValueNames()) { if ($n) { $progids.Add($n) } } }
}
foreach ($progid in ($progids | Select-Object -Unique)) {
  $c = Get-Item ('Registry::HKEY_CLASSES_ROOT\\' + $progid + '\\shell\\open\\command')
  if ($c) { Add-Exe ($c.GetValue('')) }
}
$list = Get-Item ('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\' + $ext + '\\OpenWithList')
if ($list) {
  foreach ($n in $list.GetValueNames()) {
    if ($n -eq 'MRUList') { continue }
    $exe = [string]$list.GetValue($n)
    if (-not $exe) { continue }
    $c = Get-Item ('Registry::HKEY_CLASSES_ROOT\\Applications\\' + $exe + '\\shell\\open\\command')
    if ($c) { Add-Exe ($c.GetValue('')) }
  }
}
$result = @()
foreach ($exe in ($exes | Select-Object -Unique)) {
  if (-not $exe) { continue }
  if (-not [System.IO.Path]::IsPathRooted($exe)) { continue }
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { continue }
  $name = ''
  $info = (Get-Item -LiteralPath $exe).VersionInfo
  if ($info) { $name = [string]$info.FileDescription }
  if (-not $name) { $name = [System.IO.Path]::GetFileNameWithoutExtension($exe) }
  $result += New-Object PSObject -Property @{ id = $exe; name = $name }
}
if ($result.Count -eq 0) { Write-Output '[]' } else { Write-Output (ConvertTo-Json -InputObject @($result) -Compress) }
`.trim();
  }

  /** Keeps only usable entries: an absolute executable that still exists. */
  function normalizeOpenWithPrograms(payload) {
    const rows = Array.isArray(payload) ? payload : payload ? [payload] : [];
    const seen = new Set();
    const programs = [];
    for (const row of rows) {
      const id = typeof row?.id === 'string' ? row.id.trim() : '';
      const name = typeof row?.name === 'string' ? row.name.trim() : '';
      if (!id || !path.win32.isAbsolute(id)) continue;
      if (!PROGRAM_EXTENSIONS.has(path.win32.extname(id).toLowerCase())) continue;
      if (!isLaunchableProgramFile(id)) continue;
      const key = id.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      programs.push({ id, name: name || path.win32.basename(id) });
    }
    return programs.slice(0, 20);
  }

  async function registeredProgramsFor(target) {
    if (process.platform !== 'win32') return [];
    const ext = path.win32.extname(target).toLowerCase();
    // The extension is interpolated into a script, so only a plain one may pass.
    if (!/^\.[a-z0-9_-]{1,20}$/.test(ext)) return [];
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', openWithProgramsScript(ext)],
      {
        windowsHide: true,
        timeout: 12000,
        maxBuffer: 1024 * 1024,
      },
    );
    const text = String(stdout || '').trim();
    if (!text) return [];
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return [];
    }
    return normalizeOpenWithPrograms(payload);
  }

  /** Starts one program with the file as its only argument. */
  function launchProgramWithFile(programFile, target) {
    return new Promise((resolve, reject) => {
      const child = spawn(programFile, [target], { stdio: 'ignore', windowsHide: true, detached: true });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  }

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
      return res.json({ path: resolved, programs: await registeredProgramsFor(resolved) });
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
    if (
      !program ||
      !path.win32.isAbsolute(program) ||
      !PROGRAM_EXTENSIONS.has(path.win32.extname(program).toLowerCase()) ||
      !isLaunchableProgramFile(program)
    ) {
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
      await launchProgramWithFile(program, resolved);
      return res.json({ path: resolved, program });
    } catch (error) {
      logDebug('open-with program failed', program, resolved, error?.message || error);
      return res.status(502).json({ error: 'launch-failed' });
    }
  });

  // ---------------------------------------------------------------------------
  // Real filesystem operations: copy / move / delete / mkdir / rename / write
  // ---------------------------------------------------------------------------
  // A renderer cannot write to arbitrary paths (the File System Access API needs
  // a user-granted handle per directory), so every mutating operation on a real
  // drive runs here, where Node has full filesystem access. Long transfers are
  // modelled as jobs that report byte progress and can be paused, resumed or
  // cancelled while they are running.
}

module.exports = { registerOpenWithRoutes };
