/**
 * The checks the command-bar spec makes, as pure functions.
 *
 * They live outside the spec so that the same lens can be pointed at the output
 * the shell used to print: `scripts/commandOutput.mutation.test.ts` feeds these
 * the invented adapter, table and tree, and fails if they are accepted. A check
 * that no mutation can break is a check that proves nothing, and the end-to-end
 * run only ever sees the honest version.
 *
 * Labels are Spanish because the spec pins the interface to Spanish; that is the
 * same reason the spec may assert on the header text at all.
 */

export interface LocalInterface {
  address: string;
  netmask: string;
}

export interface TreeExpectations {
  /** Folder the panel is in, which is where the tree must start. */
  root: string;
  /** Folders the tree must draw, by name. */
  folders: string[];
  /** Child -> parent pairs; the child has to sit one level deeper. */
  nested?: Record<string, string>;
  /** Names that cannot appear: the shell would be inventing them. */
  forbidden?: string[];
}

/** Everything printed after `label:` on its own line, trimmed. */
function valuesFor(text: string, label: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.includes(label))
    .map((line) => line.slice(line.indexOf(label) + label.length).trim());
}

/**
 * Why an `ipconfig` answer cannot be trusted. Empty means every address and mask
 * it printed belongs to an interface this process can see.
 */
export function ipconfigProblems(text: string, local: LocalInterface[]): string[] {
  const problems: string[] = [];
  const addresses = valuesFor(text, 'IPv4:');
  const masks = valuesFor(text, 'Máscara de subred:');

  if (addresses.length === 0) problems.push('the shell printed no IPv4 address at all');

  const knownAddresses = new Set(local.map((entry) => entry.address));
  const knownMasks = new Set(local.map((entry) => entry.netmask));
  for (const address of addresses) {
    if (!knownAddresses.has(address)) problems.push(`${address} is not an address of this machine`);
  }
  for (const mask of masks) {
    if (!knownMasks.has(mask)) problems.push(`${mask} is not the mask of any local interface`);
  }
  return problems;
}

export interface ProcessRow {
  pid: string;
  name: string;
  memoryKb: string;
}

/** The data rows of a `tasklist` answer, in the layout the shell prints. */
export function parseProcessRows(text: string): ProcessRow[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('PID'))
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts.length >= 3 && /^\d+$/.test(parts[0]))
    .map(([pid, name, memoryKb]) => ({ pid, name, memoryKb }));
}

/**
 * Why a `tasklist` answer cannot be trusted, given the PIDs this process can see
 * for itself. A few may exit between the two reads, so agreement is a floor.
 */
export function processTableProblems(text: string, observedPids: Set<string>): string[] {
  const problems: string[] = [];
  const header = text.split(/\r?\n/).find((line) => line.trim()) ?? '';
  for (const label of ['PID', 'Imagen', 'Memoria']) {
    if (!header.includes(label)) problems.push(`the header is missing "${label}"`);
  }

  const rows = parseProcessRows(text);
  if (rows.length < 20) problems.push(`only ${rows.length} processes: a real table has more than 20`);

  // The invented table had four rows and an image no machine runs.
  if (/omnicmd\.exe/i.test(text)) problems.push('the invented omnicmd.exe is back');

  const agreed = rows.filter((row) => observedPids.has(row.pid)).length;
  if (agreed < 10) problems.push(`only ${agreed} PIDs match an independent listing`);
  return problems;
}

/** Why a `tree` answer cannot be trusted for the folder it claims to describe. */
export function treeProblems(text: string, expectations: TreeExpectations): string[] {
  const problems: string[] = [];
  const lines = text.split(/\r?\n/);
  const indentOf = (line: string) => line.length - line.trimStart().length;

  const root = lines[0] ?? '';
  if (root.trim().toLowerCase() !== expectations.root.toLowerCase()) {
    problems.push(`the tree starts at "${root.trim()}", not at "${expectations.root}"`);
  }

  for (const folder of expectations.folders) {
    if (!lines.some((line) => line.trim() === folder)) problems.push(`the tree does not list ${folder}`);
  }

  for (const [child, parent] of Object.entries(expectations.nested ?? {})) {
    const childLine = lines.find((line) => line.trim() === child);
    const parentLine = lines.find((line) => line.trim() === parent);
    if (!childLine || !parentLine) continue; // Already reported as missing.
    if (indentOf(childLine) <= indentOf(parentLine)) problems.push(`${child} is not drawn under ${parent}`);
  }

  for (const forbidden of expectations.forbidden ?? []) {
    if (text.includes(forbidden)) problems.push(`${forbidden} cannot be in this tree: nothing on disk is called that`);
  }
  return problems;
}
