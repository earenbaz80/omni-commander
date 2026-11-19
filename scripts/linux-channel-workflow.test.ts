// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

// The channel steps lived in both workflows, and the copy in the tag path lost
// the beta name the preflight wrote. They are one invocation now, and this test
// is what keeps them from splitting again: it reads the YAML as text, because
// what went wrong was a copy of the shell, not a parse of the jobs.
const WORKFLOWS = ['.github/workflows/release.yml', '.github/workflows/linux-preflight.yml'];
const INVOCATION = 'node scripts/publish-linux-channel.cjs pkg';
const PROBE = 'node scripts/probe-linux-updater.cjs --version';

const text = (file: string) => fs.readFileSync(file, 'utf8');

describe('the Linux update channel', () => {
  it.each(WORKFLOWS)('%s calls the shared script exactly once, the same way', (file) => {
    expect(text(file).split(INVOCATION)).toHaveLength(2);
  });

  // Writing the channel here, or attaching it with the asset script, is how the
  // two workflows drifted apart: the script is the only caller of both now.
  it.each(WORKFLOWS)('%s leaves the writing and the attaching to the script', (file) => {
    const workflow = text(file);
    expect(workflow).not.toMatch(/linux-update-channel\.cjs/);
    expect(workflow).not.toMatch(/publish-release-asset\.mjs/);
  });

  // The tag path is the one that ships, so the feed is proven with the updater
  // the `.deb` selects, after the channel it reads has been attached.
  it('proves the tag feed with the app updater after the channel exists', () => {
    const release = text('.github/workflows/release.yml');
    const channel = release.indexOf(INVOCATION);
    const probe = release.indexOf(PROBE);
    expect(channel).toBeGreaterThan(-1);
    expect(probe).toBeGreaterThan(channel);
    expect(release.split(PROBE)).toHaveLength(2);
  });
});
