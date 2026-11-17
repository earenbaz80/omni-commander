/**
 * Windows implementation of the platform contract.
 *
 * The cleanup targets, the data roots, the Recycle Bin and the Open-with
 * registry conversation moved here from their feature modules without changing
 * their rules. The helper script and the scratch file are injected or resolved
 * lazily so this module can be loaded by `scratch.cjs` without a require cycle.
 */

const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const { assertSafePath } = require('../pathSafety.cjs');
const { createAppPaths } = require('./appPaths.cjs');
const { CONTRACT_VERSION, capabilitiesOf, definePlatform } = require('./contract.cjs');
const { createWindowsVolumes } = require('./windowsVolumes.cjs');

const WIN32 = path.win32;
const PROGRAM_EXTENSIONS = new Set(['.exe', '.com']);

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

function createWindowsPlatform(options = {}) {
  const env = options.env || process.env;
  const normalizePath = options.normalizePath || assertSafePath;
  const execFileAsync = options.execFileAsync || promisify(execFile);
  const spawnProcess = options.spawnProcess || spawn;
  const tempOverride = String(env.OMNI_CLEANUP_USER_TEMP_ROOT || '').trim();
  const volumes = createWindowsVolumes({
    fs: options.fs,
    execFileAsync: options.execFileAsync,
    logDebug: options.logDebug,
    powershellTimeoutMs: options.powershellTimeoutMs,
  });
  // Lazy so requiring this module from `scratch.cjs` (which needs `paths`) does
  // not create a require cycle. A test can pass its own function.
  const scratchFile = options.scratchFile || ((name) => require('../scratch.cjs').scratchFile(name));

  const targets = Object.freeze({
    'user-temp': Object.freeze({
      resolve: () => env.TEMP || env.TMP || '',
      requiresAdmin: false,
    }),
    'windows-temp': Object.freeze({
      resolve: () => WIN32.join(env.SystemRoot || 'C:\\Windows', 'Temp'),
      requiresAdmin: true,
    }),
    prefetch: Object.freeze({
      resolve: () => WIN32.join(env.SystemRoot || 'C:\\Windows', 'Prefetch'),
      requiresAdmin: true,
    }),
  });

  /** Where a cleanup target points, whether or not it may be acted on. */
  function targetPath(targetId) {
    const target = targets[targetId];
    if (!target) return '';
    const raw = targetId === 'user-temp' && tempOverride ? tempOverride : target.resolve();
    if (!raw) return '';
    try {
      return normalizePath(raw);
    } catch {
      return '';
    }
  }

  /** Resolves a cleanup target to the one folder it is allowed to touch. */
  function resolveRoot(targetId) {
    if (!targets[targetId]) throw new Error(`Unknown cleanup target: ${String(targetId || '')}`);
    if (targets[targetId].requiresAdmin) {
      throw new Error(`${targetId} needs administrator rights`);
    }
    const root = targetPath(targetId);
    if (!root) throw new Error(`No folder for cleanup target: ${String(targetId || '')}`);
    // Emptying a drive root would be the whole disk; refuse rather than trust
    // that TEMP is always somewhere sensible inside a user profile.
    if (/^[a-zA-Z]:\\$/.test(root)) throw new Error(`Refusing to clean a drive root: ${root}`);
    return root;
  }

  const paths = createAppPaths({
    env,
    pathApi: WIN32,
    baseDir: () => {
      const roaming = String(env.APPDATA || '').trim();
      if (roaming) return roaming;
      return String(env.XDG_CONFIG_HOME || '').trim() || WIN32.join(os.homedir(), '.config');
    },
  });

  // Windows Recycle Bin access needs the VisualBasic FileSystem API, which is
  // only reachable through PowerShell. The helper script is generated once.
  let recycleScriptPath = null;
  function ensureRecycleScript() {
    if (recycleScriptPath) return recycleScriptPath;
    const scriptPath = scratchFile(`omnicommander-recycle-${process.pid}.ps1`);
    const lines = [
      'param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Targets)',
      'Add-Type -AssemblyName Microsoft.VisualBasic',
      'foreach ($t in $Targets) {',
      '  if (-not (Test-Path -LiteralPath $t)) { continue }',
      '  if ((Get-Item -LiteralPath $t -Force).PSIsContainer) {',
      "    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($t, 'OnlyErrorDialogs', 'SendToRecycleBin')",
      '  } else {',
      "    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($t, 'OnlyErrorDialogs', 'SendToRecycleBin')",
      '  }',
      '}',
    ];
    fs.writeFileSync(scriptPath, lines.join('\r\n'), 'utf8');
    recycleScriptPath = scriptPath;
    return scriptPath;
  }

  const trash = Object.freeze({
    async move(targets, moveOptions = {}) {
      const timeoutMs = moveOptions.timeoutMs || 300000;
      await execFileAsync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ensureRecycleScript(), ...targets],
        { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: timeoutMs },
      );
    },
  });

  function isLaunchableProgramFile(file) {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  }

  /** Keeps only usable entries: an absolute executable that still exists. */
  function normalizeOpenWithPrograms(payload) {
    const rows = Array.isArray(payload) ? payload : payload ? [payload] : [];
    const seen = new Set();
    const programs = [];
    for (const row of rows) {
      const id = typeof row?.id === 'string' ? row.id.trim() : '';
      const name = typeof row?.name === 'string' ? row.name.trim() : '';
      if (!id || !WIN32.isAbsolute(id)) continue;
      if (!PROGRAM_EXTENSIONS.has(WIN32.extname(id).toLowerCase())) continue;
      if (!isLaunchableProgramFile(id)) continue;
      const key = id.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      programs.push({ id, name: name || WIN32.basename(id) });
    }
    return programs.slice(0, 20);
  }

  async function programsFor(target) {
    const ext = WIN32.extname(target).toLowerCase();
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

  function isProgram(program) {
    return (
      Boolean(program) &&
      WIN32.isAbsolute(program) &&
      PROGRAM_EXTENSIONS.has(WIN32.extname(program).toLowerCase()) &&
      isLaunchableProgramFile(program)
    );
  }

  /** Starts one program with the file as its only argument. */
  function launch(programFile, target) {
    return new Promise((resolve, reject) => {
      const child = spawnProcess(programFile, [target], { stdio: 'ignore', windowsHide: true, detached: true });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  }

  /** Asks the shell for its modal "Open with" picker and returns once it starts. */
  function picker(target) {
    return new Promise((resolve, reject) => {
      const child = spawnProcess('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', target], {
        stdio: 'ignore',
        windowsHide: true,
      });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  }

  return definePlatform({
    id: 'win32',
    contractVersion: CONTRACT_VERSION,
    capabilities: capabilitiesOf({ cleanup: true, paths: true, trash: true, openWith: true, volumes: true }),
    cleanup: Object.freeze({ targets, targetPath, resolveRoot }),
    paths,
    volumes,
    trash,
    openWith: Object.freeze({ programsFor, isProgram, launch, picker }),
  });
}

module.exports = { createWindowsPlatform };
