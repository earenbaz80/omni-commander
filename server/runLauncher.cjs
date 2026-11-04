/**
 * The Run box: opening a target and starting a program.
 *
 * This is the half of the launcher that Windows' Win+R owns, and it moved out of
 * `server.cjs` as one piece because nothing else touches it. Opening a document
 * and starting a program are different levels of trust -- `/api/open` hands a
 * target to the shell, `/api/run` is the only route that spawns -- but they share
 * the resolution rules that make a typed name mean what it means in Windows, and
 * keeping those in one module is what keeps the two answers consistent.
 *
 * The rules did not change with the move. Path validation is required here, not
 * taken on faith from the caller, and `logDebug` is the only thing the server
 * still passes in.
 */
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const execFileAsync = promisify(execFile);
const { isAbsoluteLocalPath, assertSafePath } = require('./pathSafety.cjs');

/**
 * Registers `/api/open`, `/api/run` and `/api/run/suggestions`.
 *
 * Returns the pure helpers it built (command-line splitting, resolution,
 * elevation script building) so the rules can be described by a test without
 * starting a server; the routes ignore the return value.
 */
function registerRunRoutes(app, deps = {}) {
  const logDebug = typeof deps.logDebug === 'function' ? deps.logDebug : () => {};

  // -------------------------------------------------------------------------
  // Run dialog ("Ejecutar", the Win+R box)
  //
  // Windows' Run box does one thing: hand a target to the shell. This route is
  // deliberately narrower than that box. A local path is resolved and either
  // reported back as a folder (the panel navigates there, which is what a file
  // manager should do instead of spawning a second Explorer window) or handed
  // to the default program. A destination with an allowlisted scheme goes to
  // the shell as-is. Anything else is refused.
  //
  // The refusal is the security boundary, not a formality: there is no shell
  // string anywhere in this route. `cmd /c del *` typed here is one argv element
  // of rundll32 and reaches ShellExecute as a file name that does not exist, so
  // this cannot become a command interpreter by accident or on purpose.
  // -------------------------------------------------------------------------
  const RUN_TARGET_MAX_LENGTH = 2048;
  const RUN_COMMAND_MAX_LENGTH = 4096;
  const RUN_URI_SCHEMES = new Set(['http:', 'https:', 'ms-settings:', 'shell:', 'ms-windows-store:']);
  // Windows' Run box also takes an address without the scheme ("google.com"),
  // and opens it in the default browser. Only a host that is recognisably a web
  // site is treated that way -- a dot plus a real top-level domain, or localhost
  // with a port -- so a file name such as "notas.txt" is still refused instead of
  // being sent to a browser that cannot do anything with it.
  const RUN_WEB_TLDS = new Set([
    'com',
    'net',
    'org',
    'edu',
    'gov',
    'int',
    'io',
    'dev',
    'ai',
    'app',
    'co',
    'es',
    'mx',
    'ar',
    'cl',
    'pe',
    've',
    'uk',
    'de',
    'fr',
    'it',
    'pt',
    'br',
    'nl',
    'ru',
    'pl',
    'tr',
    'cn',
    'jp',
    'kr',
    'in',
    'ca',
    'au',
    'eu',
    'us',
    'tv',
    'me',
    'info',
    'biz',
    'online',
    'site',
    'store',
    'cloud',
    'tech',
    'shop',
    'blog',
    'xyz',
    'gg',
    'sh',
    'ly',
  ]);
  const RUN_CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
  // Set by the suites, and by anyone who wants to see what a target would do
  // without a window opening: both routes answer with the raw argv instead.
  const RUN_DRY_RUN = process.env.OMNI_RUN_DRY_RUN === '1';

  /** True when the text is a web address written without its scheme. */
  function looksLikeWebAddress(value) {
    // A space is an argument and a backslash is a Windows path: neither is a host.
    // A forward slash is allowed, because it is how an address carries its path.
    if (/[\s\\]/.test(value)) return false;
    if (/^localhost(:\d{1,5})?(?:[/?#]\S*)?$/i.test(value)) return true;
    // The port and any path are checked separately so "example.com:8080/x?y" is
    // still one address, while "C:file.txt" keeps its drive letter and fails.
    const match = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+([a-z]{2,})(?::\d{1,5})?(?:[/?#]\S*)?$/i.exec(value);
    return Boolean(match && RUN_WEB_TLDS.has(match[1].toLowerCase()));
  }

  //
  // The folders Windows opens by a bare name. `temp` is not a path on disk as
  // typed (it is %TEMP%), and `prefetch` only exists under the Windows folder, so
  // the name has to become one before the absolute-path branch can answer with a
  // folder. These are the names people actually type into Run when they clean up
  // or poke at the system; %TEMP% keeps meaning the same folder as `temp`.
  function shellFolderAlias(name) {
    const winDir = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    const profile = process.env.USERPROFILE || '';
    const roaming = process.env.APPDATA || (profile && path.win32.join(profile, 'AppData', 'Roaming'));
    const system32 = path.win32.join(winDir, 'System32');
    const aliases = {
      temp: os.tmpdir(),
      tmp: os.tmpdir(),
      prefetch: path.win32.join(winDir, 'Prefetch'),
      windir: winDir,
      systemroot: winDir,
      windows: winDir,
      system32,
      syswow64: path.win32.join(winDir, 'SysWOW64'),
      drivers: path.win32.join(system32, 'drivers'),
      fonts: path.win32.join(winDir, 'Fonts'),
      appdata: roaming,
      localappdata: process.env.LOCALAPPDATA,
      userprofile: profile,
      programdata: process.env.ProgramData,
      programfiles: process.env.ProgramFiles,
      'program files': process.env.ProgramFiles,
      public: process.env.PUBLIC,
    };
    // The user's own folders are only names when there is a profile to point
    // them at; a missing one must stay unresolved rather than become a
    // relative path that the safety check would have to reject later.
    if (profile) {
      Object.assign(aliases, {
        desktop: path.win32.join(profile, 'Desktop'),
        downloads: path.win32.join(profile, 'Downloads'),
        documents: path.win32.join(profile, 'Documents'),
        pictures: path.win32.join(profile, 'Pictures'),
        music: path.win32.join(profile, 'Music'),
        videos: path.win32.join(profile, 'Videos'),
      });
    }
    if (roaming) {
      const shell = path.win32.join(roaming, 'Microsoft', 'Windows');
      Object.assign(aliases, {
        startup: path.win32.join(shell, 'Start Menu', 'Programs', 'Startup'),
        recent: path.win32.join(shell, 'Recent'),
        sendto: path.win32.join(shell, 'SendTo'),
      });
    }
    const resolved = aliases[String(name).trim().toLowerCase()];
    return typeof resolved === 'string' && resolved ? resolved : null;
  }

  // %TEMP% (and friends) is how people write paths in the Run box, so expand the
  // names the environment actually knows. An unknown name stays untouched and
  // then fails as a path, instead of collapsing to an empty string that would
  // silently point at the current directory.
  function expandRunEnvVars(value) {
    return value.replace(/%([^%\\/\r\n]{1,64})%/g, (match, name) => {
      const key = Object.keys(process.env).find((candidate) => candidate.toUpperCase() === name.toUpperCase());
      return key ? process.env[key] : match;
    });
  }

  // -------------------------------------------------------------------------
  // Resolving a typed name the way the Run box does
  //
  // CreateProcess alone only finds an .exe on PATH, which is why a name like
  // `services.msc`, a Start Menu entry or a batch file used to fail even though
  // Windows' own Run box starts all three. The lists below reproduce that reach:
  // installers register short names under App Paths, PATH is searched with the
  // usual extensions, and a label can name a Start Menu shortcut.
  //
  // The security rule does not move: the command line is still split into argv
  // and never handed to a shell as a string. A batch file is the one case that
  // needs an interpreter, so cmd.exe is named in the argv the user approves.
  // -------------------------------------------------------------------------
  const RUN_SCRIPT_EXTENSIONS = new Set(['.bat', '.cmd']);
  const RUN_SHELL_EXTENSIONS = new Set(['.lnk', '.url', '.msc', '.cpl', '.msi', '.scr']);
  // The extensions a bare name is completed with, in the order Windows tries
  // them. The last two are not executables, but they are exactly the names people
  // type into Run (services.msc, appwiz.cpl) and the shell knows how to open them.
  const RUN_LOOKUP_EXTENSIONS = ['.exe', '.com', '.bat', '.cmd', '.msc', '.cpl'];
  const APP_PATHS_ROOTS = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths',
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths',
  ];

  function isFile(file) {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  }

  /** PATH in Windows' order. A missing PATH still leaves the absolute cases working. */
  function pathDirectories() {
    return String(process.env.PATH || '')
      .split(path.win32.delimiter)
      .filter(Boolean);
  }

  /**
   * App Paths is the registry key installers write so `chrome` or `winword`
   * works without a path. It is read through reg.exe, and a value that no longer
   * exists on disk is ignored instead of offered as a program.
   */
  async function registryAppPath(name) {
    if (process.platform !== 'win32') return null;
    const names = path.win32.extname(name) ? [name] : [`${name}.exe`, name];
    for (const root of APP_PATHS_ROOTS) {
      for (const candidate of names) {
        try {
          const { stdout } = await execFileAsync('reg.exe', ['query', `${root}\\${candidate}`, '/ve'], {
            windowsHide: true,
            timeout: 5000,
          });
          const line = String(stdout)
            .split(/\r?\n/)
            .find((row) => row.includes('REG_SZ'));
          if (!line) continue;
          const value = line
            .split('REG_SZ')
            .slice(1)
            .join('REG_SZ')
            .trim()
            .replace(/^"([\s\S]*)"$/, '$1')
            .trim();
          if (value && isFile(value)) return value;
        } catch {
          // Not registered here; try the next root.
        }
      }
    }
    return null;
  }

  /**
   * The file a bare name points at: App Paths first (that is what an installer
   * registered on purpose), then PATH with the Run box's extensions. A name with
   * a path in it is never completed, so resolution stays away from the cwd.
   */
  async function resolveProgramFile(command) {
    if (path.win32.isAbsolute(command)) return isFile(command) ? command : null;
    if (/[\\/]/.test(command)) return null;
    const registered = await registryAppPath(command);
    if (registered) return registered;
    const extensions = path.win32.extname(command) ? [''] : RUN_LOOKUP_EXTENSIONS;
    for (const directory of pathDirectories()) {
      for (const extension of extensions) {
        const candidate = path.win32.join(directory, `${command}${extension}`);
        if (isFile(candidate)) return candidate;
      }
    }
    return null;
  }

  /**
   * A batch file is not an executable: CreateProcess cannot start one. cmd is the
   * interpreter that can, and it is named in the argv the user reads and
   * approves. /s makes cmd strip only the outer pair of quotes, so a path with
   * spaces survives as one token.
   */
  function scriptArgv(file, args) {
    const quoted = [file, ...args].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(' ');
    return ['cmd.exe', '/d', '/s', '/c', `"${quoted}"`];
  }

  /** What a resolved file becomes: a process, a script run by cmd, or a shell target. */
  function describeResolvedFile(file, args) {
    const extension = path.win32.extname(file).toLowerCase();
    if (RUN_SCRIPT_EXTENSIONS.has(extension)) {
      return { kind: 'script', target: file, argv: scriptArgv(file, args) };
    }
    if (RUN_SHELL_EXTENSIONS.has(extension)) {
      // Associations (MMC, Control Panel, shortcuts, installers) are ShellExecute's
      // job, reached through the same rundll32 entry point /api/open uses.
      return { kind: 'shell', target: file, argv: ['rundll32.exe', 'url.dll,FileProtocolHandler', file] };
    }
    return { kind: 'program', target: file, argv: [file, ...args] };
  }

  /**
   * Resolves one typed line: the program file, or the Start Menu shortcut whose
   * label was typed. Extra arguments are only passed to a real executable; a
   * shell target has no argument channel, which is how Run treats a shortcut too.
   *
   * A label is not always one word. "Google Chrome" and "Visual Studio Code" are
   * the names people type, and Run starts them, so the whole line is tried as a
   * label before the first word is given up on. A label can also be followed by
   * what to open ("Visual Studio Code C:\proyecto"): the longest prefix that names
   * a shortcut wins and the rest is the argument list.
   */
  async function resolveRunEntry(argv) {
    const [command, ...args] = argv;
    // The label is tried first. A full application name typed as its Start Menu
    // entry is the program the user means, even when a helper of the same name
    // happens to sit on PATH ("file explorer" versus a `file.exe` in a tool
    // folder): the menu is what the suggestions offer, so it must win here too.
    const items = await currentStartMenuItems();
    const labels = new Map(items.map((item) => [foldText(item.label), item]));
    for (let split = argv.length; split >= 1; split -= 1) {
      const shortcut = labels.get(foldText(argv.slice(0, split).join(' ')));
      if (!shortcut) continue;
      const target = shortcut.value.replace(/^"([\s\S]*)"$/, '$1');
      return describeResolvedFile(target, argv.slice(split));
    }
    const file = await resolveProgramFile(command);
    if (file) return describeResolvedFile(file, args);
    return { kind: 'missing', target: command, argv };
  }

  // ShellExecute through rundll32: the same default-program decision the Run box
  // makes, with the target as a separate argument so an `&` or a `;` in a file
  // name stays part of the file name.
  async function shellOpen(target) {
    const argv = ['url.dll,FileProtocolHandler', target];
    if (RUN_DRY_RUN) return ['rundll32.exe', ...argv];
    await execFileAsync('rundll32.exe', argv, { timeout: 15000, windowsHide: true });
    return null;
  }

  app.post('/api/open', async (req, res) => {
    const raw = typeof (req.body || {}).target === 'string' ? req.body.target : '';
    // Quoting a path is normal in the Run box ("C:\Program Files").
    const unquoted = raw
      .trim()
      .replace(/^"([\s\S]*)"$/, '$1')
      .trim();
    if (!unquoted) return res.status(400).json({ error: 'empty-target' });
    if (unquoted.length > RUN_TARGET_MAX_LENGTH) return res.status(400).json({ error: 'target-too-long' });
    if (RUN_CONTROL_CHARS.test(unquoted)) return res.status(400).json({ error: 'invalid-target' });

    const target = expandRunEnvVars(unquoted);

    if (isAbsoluteLocalPath(target)) {
      let resolved;
      try {
        resolved = assertSafePath(target);
      } catch {
        return res.status(400).json({ error: 'invalid-target' });
      }
      const stat = await fs.promises.stat(resolved).catch((error) => {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
        return error;
      });
      if (stat instanceof Error) {
        logDebug('open stat failed', resolved, stat.message);
        return res.status(403).json({ error: 'not-accessible', path: resolved });
      }
      if (!stat) return res.status(404).json({ error: 'not-found', path: resolved });
      if (stat.isDirectory()) return res.json({ kind: 'folder', path: resolved });
      try {
        const launched = await shellOpen(resolved);
        return res.json({ kind: 'opened', path: resolved, launched: launched || undefined });
      } catch (error) {
        logDebug('open failed', resolved, error?.message || error);
        return res.status(502).json({ error: 'launch-failed', path: resolved });
      }
    }

    // A folder Windows names without a path (`temp`, `prefetch`, `system32`,
    // `downloads`). It answered "unsupported" before, which is why typing `temp`
    // in this launcher did nothing while the Run box opens it. The alias is
    // trusted only once it is a real, allowed directory on this machine.
    const alias = shellFolderAlias(target);
    if (alias) {
      let aliasPath = null;
      try {
        aliasPath = assertSafePath(alias);
      } catch {
        aliasPath = null;
      }
      const stat = aliasPath ? await fs.promises.stat(aliasPath).catch(() => null) : null;
      if (stat && stat.isDirectory()) return res.json({ kind: 'folder', path: aliasPath });
    }

    const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(target);
    if (scheme && RUN_URI_SCHEMES.has(`${scheme[1].toLowerCase()}:`)) {
      try {
        const launched = await shellOpen(target);
        return res.json({ kind: 'opened', target, launched: launched || undefined });
      } catch (error) {
        logDebug('open failed', target, error?.message || error);
        return res.status(502).json({ error: 'launch-failed', target });
      }
    }

    // A name Windows already knows without a path: the Start Menu entry of an
    // installed application, or a destination the shell owns (services.msc,
    // appwiz.cpl). The target is resolved as one argv element, so a label with
    // spaces in it ("Google Chrome") opens its entry and nothing is dropped from
    // the line; executables are still left to /api/run, which is the only route
    // that spawns.
    let resolved = null;
    try {
      resolved = await resolveRunEntry([target]);
    } catch (error) {
      logDebug('open resolution failed', target, error?.message || error);
    }
    if (resolved && resolved.kind === 'shell') {
      try {
        const launched = await shellOpen(resolved.target);
        return res.json({ kind: 'opened', target: resolved.target, launched: launched || undefined });
      } catch (error) {
        logDebug('open failed', resolved.target, error?.message || error);
        return res.status(502).json({ error: 'launch-failed', target: resolved.target });
      }
    }

    // Last, the address typed without its scheme. The shortcut lookup above runs
    // first because a real Start Menu entry is a thing on this machine, while a
    // host is the shell's business: it is handed over as a proper http URL so the
    // browser does not mistake "google.com" for a search or a local file.
    if (looksLikeWebAddress(target)) {
      const address = `http://${target}`;
      try {
        const launched = await shellOpen(address);
        return res.json({ kind: 'opened', target: address, launched: launched || undefined });
      } catch (error) {
        logDebug('open failed', address, error?.message || error);
        return res.status(502).json({ error: 'launch-failed', target: address });
      }
    }

    return res.status(422).json({ error: 'unsupported-target' });
  });

  // -------------------------------------------------------------------------
  // Running a program (the part of Win+R that starts an executable)
  //
  // Kept apart from /api/open on purpose: opening a document and starting a
  // program are different levels of trust, and this is the only route that
  // spawns. A request without `confirmed: true` is answered with the argv the
  // line would become instead of starting it, which is what lets a caller look
  // at the command before it becomes a process. `confirmed` is not the security
  // boundary — the token and the origin check are — it is the difference between
  // asking and starting. The launcher sends it straight away, because one Enter
  // is one window in the Run box.
  //
  // There is no shell here either. The line is split into arguments by the
  // quoting rules below and handed to CreateProcess, so `&`, `|` and `>` are
  // characters inside an argument rather than operators, and `%VAR%` is
  // expanded once, before parsing, exactly as the Run box does. `cmd /c dir`
  // still works when the user asks for cmd by name; nothing is interpreted
  // behind their back.
  // --------------------------------------------------------------------------

  /** Splits a command line into argv, honouring double quotes and rejecting an unbalanced one. */
  function splitCommandLine(text) {
    const argv = [];
    let current = '';
    let quoted = false;
    let pending = false;
    for (const char of text) {
      if (char === '"') {
        quoted = !quoted;
        pending = true;
        continue;
      }
      if (!quoted && /\s/.test(char)) {
        if (pending) {
          argv.push(current);
          current = '';
          pending = false;
        }
        continue;
      }
      current += char;
      pending = true;
    }
    if (quoted) throw new Error('Unterminated quote');
    if (pending) argv.push(current);
    return argv;
  }

  // Detached on purpose: a launched program is not a child of the file manager,
  // so closing OmniCommander does not close it. stdio is ignored because this
  // process has no console to hand a program, and a GUI program does not need
  // one; a console program that requires a window asks Windows for its own.
  function launchProgram(argv) {
    return new Promise((resolve, reject) => {
      const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: 'ignore', windowsHide: false });
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
      // CreateProcess reports "no such program" and "not allowed" here, so the
      // dialog can say which of the two happened instead of a generic failure.
      child.once('error', reject);
    });
  }

  // -------------------------------------------------------------------------
  // Running as administrator
  //
  // The Run box answers Ctrl+Shift+Enter with ShellExecute's "runas" verb, and
  // that verb is what raises Windows' UAC prompt. Node cannot call ShellExecute,
  // so the same request goes through PowerShell's Start-Process -Verb RunAs.
  //
  // The script travels as -EncodedCommand (UTF-16LE, base64) so no path is ever
  // re-quoted by cmd.exe on the way in, and inside it every value is a
  // single-quoted PowerShell literal with '' escaping -- the one form that
  // survives a path like C:\Users\O'Brien without becoming two arguments.
  // -------------------------------------------------------------------------
  const ELEVATION_CANCELLED = /cancel(?:l)?ed by the user|1223/i;

  function psLiteral(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  // Start-Process joins an -ArgumentList array with single spaces, so an argument
  // with a space in it has to carry its own double quotes or it would arrive as
  // two: `notepad "C:\mis notas.txt"` has to keep the file name whole.
  function startProcessArg(value) {
    return /[\s"]/.test(value) ? `"${String(value).replace(/"/g, '\\"')}"` : value;
  }

  function buildElevationScript(file, args) {
    return [
      '$ErrorActionPreference = "Stop"',
      'try {',
      `  Start-Process -FilePath ${psLiteral(file)}` +
        (args.length ? ` -ArgumentList @(${args.map((arg) => psLiteral(startProcessArg(arg))).join(', ')})` : '') +
        ' -Verb RunAs | Out-Null',
      '} catch {',
      '  [Console]::Error.WriteLine($_.Exception.Message)',
      '  exit 1',
      '}',
    ].join('\n');
  }

  function launchElevated(file, args) {
    const encoded = Buffer.from(buildElevationScript(file, args), 'utf16le').toString('base64');
    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.once('error', reject);
      child.once('close', (code) => {
        if (code === 0) return resolve();
        const error = new Error(stderr.trim() || `elevation exited with ${code}`);
        // Refusing the UAC prompt is an answer, not a defect: the dialog says so
        // instead of reporting that the program could not be started.
        error.code = ELEVATION_CANCELLED.test(stderr) ? 'ELEVATION_CANCELLED' : 'ELEVATION_FAILED';
        reject(error);
      });
    });
  }

  app.post('/api/run', async (req, res) => {
    const body = req.body || {};
    const raw = typeof body.command === 'string' ? body.command.trim() : '';
    if (!raw) return res.status(400).json({ error: 'empty-command' });
    if (raw.length > RUN_COMMAND_MAX_LENGTH) return res.status(400).json({ error: 'command-too-long' });
    if (RUN_CONTROL_CHARS.test(raw)) return res.status(400).json({ error: 'invalid-command' });
    const elevated = body.elevated === true;

    let argv;
    try {
      argv = splitCommandLine(expandRunEnvVars(raw));
    } catch {
      return res.status(400).json({ error: 'invalid-command' });
    }
    if (!argv.length || !argv[0].trim()) return res.status(400).json({ error: 'empty-command' });

    // The plan is the resolved line, not the one that was typed: an installer's
    // short name becomes the file it registered, a Start Menu label becomes its
    // shortcut, and a batch file becomes the cmd.exe line that can run it. What
    // the user approves is what starts.
    let entry;
    try {
      entry = await resolveRunEntry(argv);
    } catch (error) {
      logDebug('run resolution failed', argv, error?.message || error);
      entry = { kind: 'missing', target: argv[0], argv };
    }

    if (entry.kind === 'missing') {
      return res.status(404).json({ error: 'program-not-found', program: argv[0] });
    }

    if (body.confirmed !== true) {
      return res.status(409).json({
        error: 'confirmation-required',
        argv: entry.argv,
        mode: entry.kind,
        target: entry.target,
        elevated,
      });
    }

    try {
      if (!RUN_DRY_RUN) {
        if (elevated) {
          // A shell target is one file the shell knows how to start, so it is
          // handed over alone; everything else keeps the plan's own argv, with
          // the program first and the arguments as Start-Process' list.
          if (entry.kind === 'shell') await launchElevated(entry.target, []);
          else await launchElevated(entry.argv[0], entry.argv.slice(1));
        } else if (entry.kind === 'shell') await shellOpen(entry.target);
        else await launchProgram(entry.argv);
      }
      return res.json({ kind: 'launched', argv: entry.argv, mode: entry.kind, target: entry.target, elevated });
    } catch (error) {
      logDebug('run failed', entry.argv, error?.message || error);
      if (error?.code === 'ELEVATION_CANCELLED')
        return res.status(403).json({ error: 'elevation-denied', program: argv[0] });
      if (error?.code === 'ENOENT') return res.status(404).json({ error: 'program-not-found', program: argv[0] });
      if (error?.code === 'EACCES') return res.status(403).json({ error: 'program-not-accessible', program: argv[0] });
      return res.status(502).json({ error: 'launch-failed', program: argv[0] });
    }
  });

  // -------------------------------------------------------------------------
  // Suggestions for the Run box
  //
  // Two local sources. The Start Menu is where an installed application really
  // is on Windows, so the scan reads it instead of guessing PATH; and a short
  // list of names Windows already answers to (ms-settings:, services.msc,
  // shell:startup...) covers the destinations that are typed by hand.
  //
  // A program is suggested as its shortcut path, never as a bare name: the path
  // is something /api/open can already act on, while a name would only launch
  // when it happened to be on PATH, which is exactly the case that makes an
  // autocomplete feel broken. The scan is cached per process, because a
  // keystroke must not walk two Start Menu trees.
  // -------------------------------------------------------------------------
  const SUGGESTION_LIMIT = 8;
  const SUGGESTION_QUERY_MAX_LENGTH = 64;
  const START_MENU_CACHE_TTL_MS = 5 * 60 * 1000;

  // Names the Run box has always accepted. They are Windows' own, not
  // translated: they have to be typed, so they are shown as they are.
  const SYSTEM_DESTINATIONS = [
    'ms-settings:',
    'ms-settings:display',
    'ms-settings:bluetooth',
    'ms-settings:windowsupdate',
    'ms-settings:appsfeatures',
    'ms-settings:network',
    'ms-settings:personalization',
    'ms-settings:privacy',
    'shell:startup',
    'shell:common startup',
    'shell:sendto',
    'shell:fonts',
    'control',
    'explorer',
    'cmd',
    'powershell',
    'regedit',
    'taskmgr',
    'services.msc',
    'devmgmt.msc',
    'diskmgmt.msc',
    'compmgmt.msc',
    'eventvwr.msc',
    'perfmon',
    'appwiz.cpl',
    'ncpa.cpl',
    'sysdm.cpl',
    'mstsc',
    'notepad',
    'calc',
    'mspaint',
    'winver',
    'cleanmgr',
    'dxdiag',
    'charmap',
    'osk',
  ];

  /** Lowercase without diacritics, so "Notas" matches "notas" and "música" matches "musica". */
  function foldText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function startMenuRoots() {
    const configured = String(process.env.OMNI_START_MENU_ROOTS || '').trim();
    if (configured) return configured.split(path.win32.delimiter).filter(Boolean);
    return [
      path.win32.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      process.env.APPDATA ? path.win32.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs') : '',
    ].filter(Boolean);
  }

  async function scanStartMenu() {
    const found = new Map();
    for (const root of startMenuRoots()) {
      let entries;
      try {
        entries = await fs.promises.readdir(root, { recursive: true, withFileTypes: true });
      } catch {
        // A missing or unreadable menu is normal (fresh profile, restricted
        // machine): the destinations list alone is still a useful answer.
        continue;
      }
      for (const entry of entries) {
        const name = String(entry.name || '');
        if (!/\.(lnk|url)$/i.test(name)) continue;
        // Shortcuts for removing a program are noise in a launcher.
        if (/uninstall|desinstal|deinstall|remove|readme/i.test(name)) continue;
        const label = name
          .replace(/\.(lnk|url)$/i, '')
          .replace(/\s*-\s*(shortcut|acceso directo)$/i, '')
          .trim();
        if (!label) continue;
        const key = foldText(label);
        if (found.has(key)) continue;
        // Node 22 exposes parentPath; `path` is the older spelling of the same thing.
        const parent = entry.parentPath || entry.path || root;
        found.set(key, { value: path.win32.join(parent, name), label, kind: 'app' });
      }
    }
    return [...found.values()];
  }

  let startMenuCache = { at: 0, items: [] };
  let startMenuScan = null;

  /**
   * One scan at a time and one cache, shared by the suggestion list and by the
   * resolver: typing a name must not walk two Start Menu trees, and the entry the
   * list offered must be the entry that launches.
   */
  async function currentStartMenuItems() {
    if (Date.now() - startMenuCache.at > START_MENU_CACHE_TTL_MS) {
      startMenuScan = startMenuScan || scanStartMenu().finally(() => (startMenuScan = null));
      const items = await startMenuScan;
      startMenuCache = { at: Date.now(), items };
    }
    return startMenuCache.items;
  }

  app.get('/api/run/suggestions', async (req, res) => {
    const raw = typeof req.query.q === 'string' ? req.query.q : '';
    if (raw.length > SUGGESTION_QUERY_MAX_LENGTH) return res.status(400).json({ error: 'query-too-long' });
    const query = foldText(raw).trim();
    if (!query) return res.json({ suggestions: [] });

    let programs = [];
    try {
      programs = await currentStartMenuItems();
    } catch (error) {
      logDebug('start menu scan failed', error?.message || error);
    }

    const system = SYSTEM_DESTINATIONS.map((value) => ({ value, kind: 'system' }));
    const rank = (entry) => {
      const label = foldText(entry.label || entry.value);
      const target = foldText(entry.value);
      // A prefix match is what the user is almost always typing; a hit in the
      // middle of the name comes later, alphabetically inside each group.
      if (label.startsWith(query) || target.startsWith(query)) return 0;
      return 1;
    };

    const suggestions = [...system, ...programs]
      .filter((entry) => foldText(entry.label || entry.value).includes(query) || foldText(entry.value).includes(query))
      .sort((a, b) => rank(a) - rank(b) || String(a.label || a.value).localeCompare(String(b.label || b.value)))
      .slice(0, SUGGESTION_LIMIT);

    res.json({ suggestions });
  });

  return {
    splitCommandLine,
    expandRunEnvVars,
    looksLikeWebAddress,
    shellFolderAlias,
    scriptArgv,
    describeResolvedFile,
    buildElevationScript,
    startProcessArg,
  };
}

module.exports = { registerRunRoutes };
