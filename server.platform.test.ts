// @vitest-environment node
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The platform seam has two jobs: make every capability explicit and keep the
 * Windows cleanup rules in one adapter. These tests drive the contract directly;
 * `server.cleanup.test.ts` still boots the real server and checks the behavior
 * over HTTP.
 */

const {
  CAPABILITIES,
  CONTRACT_VERSION,
  assertPlatform,
  capabilitiesOf,
  definePlatform,
  requireCapability,
} = require('./server/platform/contract.cjs');
const { createPlatform } = require('./server/platform/index.cjs');
const { createLinuxPlatform } = require('./server/platform/linux.cjs');
const { createWindowsPlatform } = require('./server/platform/windows.cjs');
const { createFileOps } = require('./server/fileOps.cjs');

const cleanup = {
  targets: Object.freeze({}),
  targetPath: () => '',
  resolveRoot: () => '',
};

function makeAdapter(overrides: Record<string, unknown> = {}) {
  return definePlatform({
    id: 'win32',
    contractVersion: CONTRACT_VERSION,
    capabilities: capabilitiesOf({ cleanup: true }),
    cleanup,
    ...overrides,
  });
}

describe('platform contract', () => {
  it('accepts a complete adapter and freezes its declaration', () => {
    const adapter = makeAdapter();

    expect(assertPlatform(adapter)).toBe(adapter);
    expect(Object.isFrozen(adapter)).toBe(true);
    expect(Object.isFrozen(adapter.capabilities)).toBe(true);
    expect(Object.keys(adapter.capabilities)).toEqual(CAPABILITIES);
    expect(adapter.capabilities.cleanup).toBe(true);
    expect(adapter.capabilities.volumes).toBe(false);
  });

  it('rejects a version, an id or a capability it does not know', () => {
    expect(() => assertPlatform({ ...makeAdapter(), contractVersion: 0 })).toThrow(/contract version/);
    expect(() => assertPlatform({ ...makeAdapter(), id: 'darwin' })).toThrow(/Unknown platform adapter/);

    const missing = { ...makeAdapter(), capabilities: { ...makeAdapter().capabilities } };
    delete missing.capabilities.cleanup;
    expect(() => assertPlatform(missing)).toThrow(/capability cleanup/);
  });

  it('rejects an adapter that declares cleanup without implementing it', () => {
    expect(() => assertPlatform({ ...makeAdapter(), cleanup: undefined })).toThrow(/declares cleanup/);
  });

  it('rejects an adapter that declares volumes without implementing them', () => {
    const adapter = makeAdapter();
    expect(() =>
      assertPlatform({
        ...adapter,
        capabilities: { ...adapter.capabilities, volumes: true },
      }),
    ).toThrow(/declares volumes/);
  });

  it('rejects an adapter that declares paths without implementing them', () => {
    const adapter = makeAdapter();
    expect(() =>
      assertPlatform({
        ...adapter,
        capabilities: { ...adapter.capabilities, paths: true },
      }),
    ).toThrow(/declares paths/);
  });

  it('rejects an adapter that declares trash without implementing it', () => {
    const adapter = makeAdapter();
    expect(() =>
      assertPlatform({
        ...adapter,
        capabilities: { ...adapter.capabilities, trash: true },
      }),
    ).toThrow(/declares trash/);
  });

  it('rejects an adapter that declares openWith without implementing it', () => {
    const adapter = makeAdapter();
    expect(() =>
      assertPlatform({
        ...adapter,
        capabilities: { ...adapter.capabilities, openWith: true },
      }),
    ).toThrow(/declares openWith/);
  });

  it('fails a feature that asks for a capability the adapter does not have', () => {
    const linux = createPlatform('linux');

    expect(linux.id).toBe('linux');
    expect(linux.capabilities.cleanup).toBe(true);
    expect(linux.capabilities.trash).toBe(true);
    expect(linux.capabilities.openWith).toBe(false);
    expect(linux.capabilities.volumes).toBe(true);
    expect(requireCapability(linux, 'volumes')).toBe(linux.volumes);
    expect(requireCapability(linux, 'trash')).toBe(linux.trash);
    expect(requireCapability(linux, 'cleanup')).toBe(linux.cleanup);
    expect(() => requireCapability(linux, 'openWith')).toThrow(/does not implement openWith/);
    expect(requireCapability(makeAdapter(), 'cleanup')).toBe(cleanup);
  });

  it('selects the adapter from one place and refuses an unknown platform', () => {
    expect(createPlatform('win32').id).toBe('win32');
    expect(createPlatform('win32').capabilities.paths).toBe(true);
    expect(createPlatform('win32').capabilities.openWith).toBe(true);
    expect(createPlatform('win32').capabilities.volumes).toBe(true);
    expect(createPlatform('linux').id).toBe('linux');
    expect(createPlatform('linux').capabilities.paths).toBe(true);
    expect(createPlatform('linux').capabilities.volumes).toBe(true);
    expect(() => createPlatform('darwin')).toThrow(/Unsupported platform: darwin/);
  });
});

describe('Windows cleanup adapter', () => {
  const env = {
    SystemRoot: String.raw`D:\Windows`,
    TEMP: String.raw`C:\Temp`,
    TMP: String.raw`C:\Tmp`,
  };

  it('resolves the same three targets in the same order', () => {
    const windows = createWindowsPlatform({ env });

    expect(Object.keys(windows.cleanup.targets)).toEqual(['user-temp', 'windows-temp', 'prefetch']);
    expect(windows.cleanup.targetPath('user-temp')).toBe(String.raw`C:\Temp`);
    expect(windows.cleanup.targetPath('windows-temp')).toBe(String.raw`D:\Windows\Temp`);
    expect(windows.cleanup.targetPath('prefetch')).toBe(String.raw`D:\Windows\Prefetch`);
    expect(Object.isFrozen(windows.cleanup.targets)).toBe(true);
  });

  it('keeps the test override limited to the user temp target', () => {
    const windows = createWindowsPlatform({
      env: { ...env, OMNI_CLEANUP_USER_TEMP_ROOT: String.raw`C:\Scratch` },
    });

    expect(windows.cleanup.targetPath('user-temp')).toBe(String.raw`C:\Scratch`);
    expect(windows.cleanup.targetPath('windows-temp')).toBe(String.raw`D:\Windows\Temp`);
  });

  it('refuses elevated or unknown targets before walking anything', () => {
    const windows = createWindowsPlatform({ env });

    expect(() => windows.cleanup.resolveRoot('prefetch')).toThrow('prefetch needs administrator rights');
    expect(() => windows.cleanup.resolveRoot('C:\\')).toThrow(/Unknown cleanup target/);
    expect(() => windows.cleanup.resolveRoot('nope')).toThrow(/Unknown cleanup target/);
  });

  it('refuses a drive root and reports an empty target', () => {
    const root = createWindowsPlatform({ env: { ...env, TEMP: 'C:\\\\', TMP: '' } });
    const empty = createWindowsPlatform({ env: { ...env, TEMP: '', TMP: '' } });

    expect(() => root.cleanup.resolveRoot('user-temp')).toThrow(/Refusing to clean a drive root/);
    expect(empty.cleanup.targetPath('user-temp')).toBe('');
    expect(() => empty.cleanup.resolveRoot('user-temp')).toThrow(/No folder for cleanup target/);
  });
});

describe('Linux cleanup adapter', () => {
  it('resolves the user temp target and leaves the Windows folders out', () => {
    const linux = createLinuxPlatform({ env: { TMPDIR: '/var/tmp/user' } });

    expect(Object.keys(linux.cleanup.targets)).toEqual(['user-temp']);
    expect(linux.cleanup.targetPath('user-temp')).toBe('/var/tmp/user');
    expect(linux.cleanup.targetPath('windows-temp')).toBe('');
    expect(linux.cleanup.targetPath('prefetch')).toBe('');
    expect(() => linux.cleanup.resolveRoot('prefetch')).toThrow(/Unknown cleanup target/);
  });

  it('takes the test override and refuses a filesystem root', () => {
    const overridden = createLinuxPlatform({
      env: { TMPDIR: '/tmp', OMNI_CLEANUP_USER_TEMP_ROOT: '/tmp/omni-cleanup' },
    });
    const root = createLinuxPlatform({ env: { TMPDIR: '/' } });

    expect(overridden.cleanup.targetPath('user-temp')).toBe('/tmp/omni-cleanup');
    expect(() => root.cleanup.resolveRoot('user-temp')).toThrow(/Refusing to clean a filesystem root/);
  });
});

describe('Windows data paths', () => {
  const env = {
    APPDATA: String.raw`C:\Users\Admin\AppData\Roaming`,
    XDG_CONFIG_HOME: '',
  };

  it('builds the app folders under APPDATA', () => {
    const windows = createWindowsPlatform({ env });

    expect(windows.capabilities.paths).toBe(true);
    expect(windows.paths.appDataDir()).toBe(String.raw`C:\Users\Admin\AppData\Roaming\omnicommander-pro`);
    expect(windows.paths.scratchDir()).toBe(String.raw`C:\Users\Admin\AppData\Roaming\omnicommander-pro\tmp`);
    expect(windows.paths.mapTilesDir()).toBe(String.raw`C:\Users\Admin\AppData\Roaming\omnicommander-pro\map-tiles`);
    expect(windows.paths.logsDir()).toBe(String.raw`C:\Users\Admin\AppData\Roaming\omnicommander-pro\logs`);
  });

  it('honours the data and folder overrides, reading them on every call', () => {
    const paths = createWindowsPlatform({ env }).paths;
    const mutable: Record<string, string> = { ...env, OMNI_DATA_DIR: String.raw`D:\Data` };
    const overridden = createWindowsPlatform({ env: mutable }).paths;

    expect(overridden.appDataDir()).toBe(String.raw`D:\Data`);
    expect(overridden.scratchDir()).toBe(String.raw`D:\Data\tmp`);
    mutable.OMNI_LOG_DIR = String.raw`E:\Logs`;
    expect(overridden.logsDir()).toBe(String.raw`E:\Logs`);
    expect(paths.appDataDir()).toBe(String.raw`C:\Users\Admin\AppData\Roaming\omnicommander-pro`);
  });

  it('falls back to the XDG location when APPDATA is absent, as before', () => {
    const windows = createWindowsPlatform({ env: { APPDATA: '', XDG_CONFIG_HOME: String.raw`C:\Config` } });

    expect(windows.paths.appDataDir()).toBe(String.raw`C:\Config\omnicommander-pro`);
  });
});

describe('Linux data paths', () => {
  it('builds the app folders under XDG_CONFIG_HOME', () => {
    const linux = createLinuxPlatform({ env: { XDG_CONFIG_HOME: '/home/me/.config' } });

    expect(linux.capabilities.paths).toBe(true);
    expect(linux.paths.appDataDir()).toBe('/home/me/.config/omnicommander-pro');
    expect(linux.paths.scratchDir()).toBe('/home/me/.config/omnicommander-pro/tmp');
    expect(linux.paths.mapTilesDir()).toBe('/home/me/.config/omnicommander-pro/map-tiles');
    expect(linux.paths.logsDir()).toBe('/home/me/.config/omnicommander-pro/logs');
  });

  it('honours the same overrides and keeps cleanup on the user temp folder', () => {
    const linux = createLinuxPlatform({
      env: { XDG_CONFIG_HOME: '/home/me/.config', OMNI_DATA_DIR: '/srv/omni' },
    });

    expect(linux.paths.appDataDir()).toBe('/srv/omni');
    expect(linux.paths.scratchDir()).toBe('/srv/omni/tmp');
    expect(linux.capabilities.cleanup).toBe(true);
    expect(Object.keys(linux.cleanup.targets)).toEqual(['user-temp']);
  });
});

describe('Windows volumes adapter', () => {
  function fakeWindowsFs() {
    return {
      promises: {
        stat: async (root: string) => {
          if (root === 'C:\\') return { isDirectory: () => true };
          throw new Error('ENOENT');
        },
        statfs: async () => ({ bsize: 1024, blocks: 100, bavail: 40 }),
      },
    };
  }

  it('keeps the fast probe shape and adds WMI metadata after the warm-up', async () => {
    const calls: string[] = [];
    const windows = createWindowsPlatform({
      env: {},
      fs: fakeWindowsFs(),
      execFileAsync: async (_file: string, args: string[]) => {
        const command = args.join(' ');
        calls.push(command);
        if (command.includes('Win32_LogicalDisk')) {
          return {
            stdout: JSON.stringify([
              {
                DeviceID: 'C:',
                VolumeName: 'System',
                DriveType: 3,
                Size: 204800,
                FreeSpace: 102400,
                FileSystem: 'NTFS',
                VolumeSerialNumber: 'ABC123',
              },
            ]),
            stderr: '',
          };
        }
        return { stdout: '[]', stderr: '' };
      },
    });

    await windows.volumes.warmUp();
    const drives = await windows.volumes.list();

    expect(drives).toHaveLength(1);
    expect(drives[0]).toMatchObject({
      id: 'real_C',
      letter: 'C:',
      name: 'System',
      type: 'local',
      driveKind: 'fixed',
      fileSystem: 'NTFS',
      serialNumber: 'ABC123',
      totalBytes: 204800,
      freeBytes: 102400,
      isMounted: true,
    });
    expect(calls.some((command) => command.includes('Win32_LogicalDisk'))).toBe(true);
  });

  it('lists a disconnected network mapping once, under its remote name', async () => {
    const windows = createWindowsPlatform({
      env: {},
      fs: fakeWindowsFs(),
      execFileAsync: async (_file: string, args: string[]) => {
        const command = args.join(' ');
        if (command.includes('Win32_LogicalDisk')) {
          return {
            stdout: JSON.stringify([
              { DeviceID: 'C:', DriveType: 3 },
              { DeviceID: 'Z:', DriveType: 4, VolumeName: '' },
            ]),
            stderr: '',
          };
        }
        if (command.includes('Win32_NetworkConnection')) {
          return { stdout: JSON.stringify({ LocalName: 'Z:', RemoteName: '//server/share' }), stderr: '' };
        }
        return { stdout: '[]', stderr: '' };
      },
    });

    await windows.volumes.warmUp();
    const drives = await windows.volumes.list();
    const mapped = drives.filter((drive: { letter: string }) => drive.letter === 'Z:');

    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toMatchObject({
      id: 'real_Z',
      name: '//server/share',
      type: 'network',
      driveKind: 'network',
      isMounted: false,
    });
  });
});

describe('Linux volumes adapter', () => {
  it('reads real mount points, decodes spaces and skips pseudo filesystems', async () => {
    const mounts = [
      '/dev/sda1 / ext4 rw,relatime 0 0',
      'proc /proc proc rw,nosuid,nodev,noexec,relatime 0 0',
      '/dev/sda2 /home\\040user ext4 rw,relatime 0 0',
      '//server/share /mnt/share cifs rw,relatime 0 0',
    ].join('\n');
    const linux = createLinuxPlatform({
      env: { XDG_CONFIG_HOME: '/home/me/.config' },
      readMounts: async () => mounts,
      statfs: async () => ({ bsize: 1024, blocks: 100, bavail: 40 }),
    });

    const drives = await linux.volumes.list();

    expect(drives.map((drive: { letter: string }) => drive.letter)).toEqual(['/', '/home user', '/mnt/share']);
    expect(drives[0]).toMatchObject({
      id: 'real_root',
      name: 'Sistema',
      type: 'local',
      driveKind: 'fixed',
      fileSystem: 'ext4',
      totalBytes: 102400,
      freeBytes: 40960,
      isMounted: true,
    });
    expect(drives[2]).toMatchObject({ type: 'network', driveKind: 'network', fileSystem: 'cifs' });
  });

  it('treats /mnt as fixed and only the media roots as removable', async () => {
    const linux = createLinuxPlatform({
      env: { XDG_CONFIG_HOME: '/home/me/.config' },
      readMounts: async () =>
        [
          '/dev/sdb1 /mnt/data ext4 rw 0 0',
          '/dev/sdc1 /media/me/USB ext4 rw 0 0',
          '/dev/sdd1 /run/media/me/OTRO ext4 rw 0 0',
        ].join('\n'),
      statfs: async () => ({ bsize: 1024, blocks: 100, bavail: 40 }),
    });

    const drives = await linux.volumes.list();

    expect(drives.map((drive: { driveKind: string }) => drive.driveKind)).toEqual(['fixed', 'removable', 'removable']);
  });

  it('keeps distinct ids for mount points that would sanitise alike', async () => {
    const linux = createLinuxPlatform({
      env: { XDG_CONFIG_HOME: '/home/me/.config' },
      readMounts: async () => ['/dev/sdb1 /mnt/a-b ext4 rw 0 0', '/dev/sdc1 /mnt/ab ext4 rw 0 0'].join('\n'),
      statfs: async () => ({ bsize: 1024, blocks: 100, bavail: 40 }),
    });

    const drives = await linux.volumes.list();

    expect(new Set(drives.map((drive: { id: string }) => drive.id)).size).toBe(2);
  });
});

describe('Windows Recycle Bin adapter', () => {
  it('runs the VisualBasic helper through PowerShell with the injected scratch file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-platform-trash-'));
    const calls: { file: string; args: string[]; options: { timeout?: number } }[] = [];
    try {
      const windows = createWindowsPlatform({
        env: {},
        scratchFile: (name: string) => path.join(dir, name),
        execFileAsync: async (file: string, args: string[], options: { timeout?: number }) => {
          calls.push({ file, args, options });
          return { stdout: '', stderr: '' };
        },
      });

      expect(windows.capabilities.trash).toBe(true);
      await windows.trash.move([String.raw`C:\Temp\old.txt`], { timeoutMs: 1234 });

      expect(calls).toHaveLength(1);
      const [call] = calls;
      expect(call.file).toBe('powershell');
      expect(call.args).toContain('-File');
      expect(call.args).toContain(String.raw`C:\Temp\old.txt`);
      expect(call.options.timeout).toBe(1234);
      const scriptPath = call.args[call.args.indexOf('-File') + 1];
      expect(scriptPath).toBe(path.join(dir, `omnicommander-recycle-${process.pid}.ps1`));
      expect(fs.readFileSync(scriptPath, 'utf8')).toContain('Microsoft.VisualBasic.FileIO.FileSystem');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Linux trash adapter', () => {
  // POSIX paths are not absolute to Node's `fs` on Windows, so tests translate
  // one virtual root to the temporary folder they actually own.
  function virtualFs(root: string) {
    const prefix = '/virtual';
    const toReal = (value: string) => {
      if (!value.startsWith(prefix)) throw new Error(`unexpected path: ${value}`);
      return path.join(root, value.slice(prefix.length));
    };
    return {
      promises: {
        lstat: (value: string) => fs.promises.lstat(toReal(value)),
        mkdir: (value: string, options?: fs.MakeDirectoryOptions) => fs.promises.mkdir(toReal(value), options),
        writeFile: (value: string, data: string, options?: fs.WriteFileOptions) =>
          fs.promises.writeFile(toReal(value), data, options),
        rename: (from: string, to: string) => fs.promises.rename(toReal(from), toReal(to)),
        cp: (from: string, to: string, options?: fs.CopyOptions) => fs.promises.cp(toReal(from), toReal(to), options),
        rm: (value: string, options?: fs.RmOptions) => fs.promises.rm(toReal(value), options),
      },
    };
  }

  it('uses gio trash for the whole batch and forwards the timeout', async () => {
    const calls: { file: string; args: string[]; options: { timeout?: number } }[] = [];
    const linux = createLinuxPlatform({
      env: { XDG_DATA_HOME: '/home/me/.local/share' },
      execFileAsync: async (file: string, args: string[], options: { timeout?: number }) => {
        calls.push({ file, args, options });
        return { stdout: '', stderr: '' };
      },
    });

    expect(linux.capabilities.trash).toBe(true);
    await linux.trash.move(['/home/me/nota.txt', '/home/me/otra nota.txt'], { timeoutMs: 1234 });

    expect(calls).toEqual([
      {
        file: 'gio',
        args: ['trash', '/home/me/nota.txt', '/home/me/otra nota.txt'],
        options: expect.objectContaining({ timeout: 1234 }),
      },
    ]);
  });

  it('falls back to the XDG trash and records a URL-encoded original path', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-linux-trash-'));
    const source = path.join(dir, 'home', 'nota #1.txt');
    try {
      fs.mkdirSync(path.dirname(source), { recursive: true });
      fs.writeFileSync(source, 'hola');
      const linux = createLinuxPlatform({
        env: { XDG_DATA_HOME: '/virtual/data' },
        fs: virtualFs(dir),
        execFileAsync: async () => {
          const error = Object.assign(new Error('gio: command not found'), { code: 'ENOENT' });
          throw error;
        },
        now: () => new Date(2026, 10, 17, 12, 34, 56),
      });

      await linux.trash.move(['/virtual/home/nota #1.txt'], { timeoutMs: 500 });

      expect(fs.existsSync(source)).toBe(false);
      const filesDir = path.join(dir, 'data', 'Trash', 'files');
      const infoDir = path.join(dir, 'data', 'Trash', 'info');
      expect(fs.readdirSync(filesDir)).toEqual(['nota #1.txt']);
      const info = fs.readFileSync(path.join(infoDir, 'nota #1.txt.trashinfo'), 'utf8');
      expect(info).toContain('[Trash Info]');
      expect(info).toContain('Path=/virtual/home/nota%20%231.txt');
      expect(info).toContain('DeletionDate=2026-11-17T12:34:56');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not overwrite a different file already in the XDG trash', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-linux-trash-'));
    const source = path.join(dir, 'home', 'nota.txt');
    const filesDir = path.join(dir, 'data', 'Trash', 'files');
    const infoDir = path.join(dir, 'data', 'Trash', 'info');
    try {
      fs.mkdirSync(path.dirname(source), { recursive: true });
      fs.writeFileSync(source, 'nueva');
      fs.mkdirSync(filesDir, { recursive: true });
      fs.mkdirSync(infoDir, { recursive: true });
      fs.writeFileSync(path.join(filesDir, 'nota.txt'), 'vieja');
      fs.writeFileSync(path.join(infoDir, 'nota.txt.trashinfo'), '[Trash Info]\nPath=/old\n');

      const linux = createLinuxPlatform({
        env: { XDG_DATA_HOME: '/virtual/data' },
        fs: virtualFs(dir),
        execFileAsync: async () => {
          const error = Object.assign(new Error('gio failed'), { code: 'ENOENT' });
          throw error;
        },
      });

      await linux.trash.move(['/virtual/home/nota.txt']);

      expect(fs.readdirSync(filesDir).sort()).toEqual(['nota.txt', 'nota.txt.2']);
      expect(fs.readFileSync(path.join(filesDir, 'nota.txt'), 'utf8')).toBe('vieja');
      expect(fs.readFileSync(path.join(filesDir, 'nota.txt.2'), 'utf8')).toBe('nueva');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Windows Open-with adapter', () => {
  it('reads registered programs and keeps only existing executables', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-platform-openwith-'));
    const exe = path.join(dir, 'editor.exe');
    const text = path.join(dir, 'note.txt');
    fs.writeFileSync(exe, 'exe');
    fs.writeFileSync(text, 'txt');
    const calls: { file: string; args: string[] }[] = [];
    try {
      const windows = createWindowsPlatform({
        env: {},
        execFileAsync: async (file: string, args: string[]) => {
          calls.push({ file, args });
          return {
            stdout: JSON.stringify([
              { id: exe, name: 'Editor' },
              { id: text, name: 'Text' },
            ]),
            stderr: '',
          };
        },
      });

      const programs = await windows.openWith.programsFor(text);

      expect(programs).toEqual([{ id: exe, name: 'Editor' }]);
      expect(calls[0].file).toBe('powershell.exe');
      expect(calls[0].args.join(' ')).toContain('HKEY_CLASSES_ROOT');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts only an existing absolute executable and starts it detached', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-platform-openwith-'));
    const exe = path.join(dir, 'editor.exe');
    const notProgram = path.join(dir, 'note.txt');
    fs.writeFileSync(exe, 'exe');
    fs.writeFileSync(notProgram, 'txt');
    const calls: { file: string; args: string[]; options: { detached?: boolean } }[] = [];
    const spawnProcess = (file: string, args: string[], options: { detached?: boolean }) => {
      calls.push({ file, args, options });
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = () => {};
      setImmediate(() => child.emit('spawn'));
      return child;
    };
    try {
      const windows = createWindowsPlatform({ env: {}, spawnProcess });

      expect(windows.openWith.isProgram(exe)).toBe(true);
      expect(windows.openWith.isProgram(notProgram)).toBe(false);
      expect(windows.openWith.isProgram('editor.exe')).toBe(false);
      expect(windows.openWith.isProgram(path.join(dir, 'missing.exe'))).toBe(false);

      await windows.openWith.launch(exe, notProgram);
      await windows.openWith.picker(notProgram);

      expect(calls[0]).toEqual({ file: exe, args: [notProgram], options: expect.objectContaining({ detached: true }) });
      expect(calls[1].file).toBe('rundll32.exe');
      expect(calls[1].args).toEqual(['shell32.dll,OpenAs_RunDLL', notProgram]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('fileOps cleanup seam', () => {
  it('uses the cleanup table from the injected platform', () => {
    const targets = Object.freeze({
      fake: Object.freeze({ resolve: () => String.raw`C:\Fake`, requiresAdmin: false }),
    });
    const platform = {
      id: 'win32',
      capabilities: { cleanup: true },
      cleanup: {
        targets,
        targetPath: (id: string) => `C:\\fake\\${id}`,
        resolveRoot: (id: string) => `C:\\fake\\${id}`,
      },
    };

    const ops = createFileOps({ platform });

    expect(ops.CLEANUP_TARGETS).toBe(targets);
    expect(ops.cleanupTargetPath('fake')).toBe(String.raw`C:\fake\fake`);
    expect(ops.resolveCleanupRoot('fake')).toBe(String.raw`C:\fake\fake`);
  });

  it('delegates a delete to the platform trash and fails when there is none', async () => {
    const moves: { targets: string[]; timeoutMs: number }[] = [];
    const withTrash = {
      id: 'win32',
      capabilities: { cleanup: true, trash: true },
      cleanup,
      trash: {
        move: async (targets: string[], options: { timeoutMs: number }) => {
          moves.push({ targets, timeoutMs: options.timeoutMs });
        },
      },
    };
    const withoutTrash = {
      id: 'linux',
      capabilities: { cleanup: true, trash: false },
      cleanup,
    };

    await createFileOps({ platform: withTrash }).deleteTarget(String.raw`C:\Temp\old.txt`, true);
    expect(moves).toEqual([{ targets: [String.raw`C:\Temp\old.txt`], timeoutMs: 300000 }]);

    const ops = createFileOps({ platform: withoutTrash });
    await expect(ops.deleteTarget(String.raw`C:\Temp\old.txt`, true)).rejects.toThrow(/not supported/);
  });

  it('builds a Linux file-ops surface with the user temp cleanup target', () => {
    const ops = createFileOps({
      platform: createLinuxPlatform({ env: { XDG_CONFIG_HOME: '/tmp/omni', TMPDIR: '/tmp/omni-temp' } }),
    });

    expect(Object.keys(ops.CLEANUP_TARGETS)).toEqual(['user-temp']);
    expect(ops.resolveCleanupRoot('user-temp')).toBe('/tmp/omni-temp');
    expect(() => ops.resolveCleanupRoot('prefetch')).toThrow(/Unknown cleanup target/);
  });
});
