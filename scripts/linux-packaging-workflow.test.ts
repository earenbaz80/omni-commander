// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

// The version check lived twice, once per workflow, and each copy went red on a
// correct prerelease package before it learned Debian's `~` spelling. It is one
// script now, and this test is what keeps a copy from growing back: both
// workflows must call it, and neither may read the control version itself.
const WORKFLOWS = ['.github/workflows/release.yml', '.github/workflows/linux-preflight.yml'];
const INVOCATION = 'node scripts/check-deb-version.cjs';

const text = (file: string) => fs.readFileSync(file, 'utf8');

describe('the .deb version check', () => {
  it.each(WORKFLOWS)('%s calls the shared script exactly once', (file) => {
    expect(text(file).split(INVOCATION)).toHaveLength(2);
  });

  it.each(WORKFLOWS)('%s does not read or compare the control version itself', (file) => {
    const workflow = text(file);
    expect(workflow).not.toMatch(/dpkg-deb -f "\$deb" Version/);
    expect(workflow).not.toMatch(/debian_expected/);
    expect(workflow).not.toMatch(/\$\{expected\/-\//);
  });
});
