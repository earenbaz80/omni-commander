// @vitest-environment node
import { describe, it, expect } from 'vitest';
import os from 'node:os';
import { ipconfigProblems, parseProcessRows, processTableProblems, treeProblems } from '../e2e/support/commandOutput';

/**
 * Mutation test for the command-bar E2E.
 *
 * The end-to-end spec only ever sees the honest output, so on its own it cannot
 * prove that it would notice the dishonest one coming back. These cases take the
 * strings the app actually printed before — the fixed adapter, the four-row
 * process table with `omnicmd.exe`, the drawn tree — and feed them to the very
 * checks that spec runs. Every one of them must come back with complaints; a
 * check that a mutation can slip past is a check that proves nothing.
 *
 * The control cases build a real answer in the same layout and require zero
 * complaints, so "fails everything" is not mistaken for "catches the mutation".
 */

/** Verbatim shape of `cmdIpconfigOut`, which the shell printed for every host. */
const CANNED_IPCONFIG = [
  'Adaptador Ethernet Ethernet0:',
  '  IPv4: 192.168.1.150',
  '  Máscara de subred: 255.255.255.0',
  '  Puerta de enlace predeterminada: 192.168.1.1',
].join('\n');

/** Verbatim shape of `cmdTasklistOut`: four rows, none of them running. */
const CANNED_TASKLIST = [
  'PID    Imagen                       Memoria (KB)',
  '=========================================',
  '0004   System                   128',
  '0412   omnicmd.exe              14920',
  '1024   explorer.exe             45120',
  '2048   node.exe                 88400',
].join('\n');

/** Verbatim shape of the old `tree` branch: the same four names everywhere. */
const CANNED_TREE = 'C:\\temp\n├── OMNICMD\n├── WINDOWS\n└── Users\n    └── Administrator';

const localInterfaces = () =>
  Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => String(entry.family) === 'IPv4')
    .map((entry) => ({ address: entry.address, netmask: entry.netmask }));

describe('command-bar checks reject the invented answers', () => {
  it('rejects the fixed adapter', () => {
    const problems = ipconfigProblems(CANNED_IPCONFIG, localInterfaces());

    expect(problems.join('\n')).toContain('192.168.1.150 is not an address of this machine');
  });

  it('rejects the four-row process table', () => {
    // A real answer from this machine would agree with this set; the canned one
    // has PIDs that belong to nothing here.
    const observed = new Set(['1', '4000', '9000']);
    const problems = processTableProblems(CANNED_TASKLIST, observed);

    expect(problems.join('\n')).toContain('omnicmd.exe');
    expect(problems.join('\n')).toContain('only 4 processes');
  });

  it('rejects the drawn tree', () => {
    const problems = treeProblems(CANNED_TREE, {
      root: 'C:\\temp',
      folders: ['alfa', 'beta', 'gamma'],
      nested: { beta: 'alfa' },
      forbidden: ['nota.txt', 'OMNICMD', 'Administrator'],
    });

    const report = problems.join('\n');
    expect(report).toContain('the tree does not list alfa');
    expect(report).toContain('OMNICMD cannot be in this tree');
    expect(report).toContain('Administrator cannot be in this tree');
  });
});

describe('command-bar checks accept a measured answer', () => {
  it('accepts the interfaces this machine has', () => {
    const local = localInterfaces();
    const printed = local
      .map((entry) => `eth0:\n  IPv4: ${entry.address}\n  Máscara de subred: ${entry.netmask}`)
      .join('\n\n');

    expect(ipconfigProblems(printed, local)).toEqual([]);
  });

  it('accepts a process table that agrees with an independent listing', () => {
    const rows = Array.from({ length: 24 }, (_, index) => ({
      pid: String(4000 + index),
      name: index === 0 ? 'node.exe' : `proc${index}.exe`,
      memoryKb: String(1024 + index),
    }));
    const printed = [
      'PID    Imagen                       Memoria (KB)',
      ...rows.map((row) => `${row.pid.padEnd(7)} ${row.name.padEnd(28)} ${row.memoryKb}`),
    ].join('\n');

    expect(parseProcessRows(printed)).toHaveLength(24);
    expect(processTableProblems(printed, new Set(rows.map((row) => row.pid)))).toEqual([]);
  });

  it('accepts a tree drawn from the folders that are really there', () => {
    const printed = ['C:\\temp', 'alfa', '   beta', 'gamma'].join('\n');

    expect(
      treeProblems(printed, {
        root: 'C:\\temp',
        folders: ['alfa', 'beta', 'gamma'],
        nested: { beta: 'alfa' },
        forbidden: ['nota.txt', 'OMNICMD', 'Administrator'],
      }),
    ).toEqual([]);
  });
});
