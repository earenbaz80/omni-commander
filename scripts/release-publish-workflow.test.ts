// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

// The release page is created in one step, from whatever `release/` holds, and
// the three guards below are the only things standing between a push to master
// and a publish. They have each been wrong in a way nobody could see in a diff:
// electron-builder used to open a *draft* for the tag, the upload step could not
// find it by tag, and it created a second release while the installers stayed
// behind in the draft. This test reads the YAML as text, like the other workflow
// tests, because what matters is the shell and the step inputs, not a parse.
const WORKFLOW = '.github/workflows/release.yml';
const GATE = "if: startsWith(github.ref, 'refs/tags/v')";
const PUBLISH_JOBS = ['linux-packages', 'build', 'linux-channel'];

const text = () => fs.readFileSync(WORKFLOW, 'utf8');

// A job starts at two spaces under `jobs:` and runs to the next key at that
// indent. Reading one block at a time keeps another job's `if` from answering
// for a job that lost its own.
const jobBlock = (workflow: string, name: string): string => {
  const block = new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z][a-z-]*:\\n|$)`).exec(workflow);
  if (!block) throw new Error(`job ${name} is missing from ${WORKFLOW}`);
  return block[1];
};

describe('the release publish step', () => {
  // A draft is invisible to the "release by tag" lookup the upload uses, so the
  // step created a second release for the same tag and every installer stayed
  // behind in the draft. Publishing is one non-draft step, and no job may put a
  // draft back in front of it.
  it('publishes a release rather than a draft', () => {
    const workflow = text();
    const build = jobBlock(workflow, 'build');
    expect(build).toContain('uses: softprops/action-gh-release@');
    expect(build).toContain('draft: false');
    expect(workflow).not.toMatch(/draft:\s*true/);
    expect(workflow).not.toMatch(/draft:\s*\$\{\{/);
  });

  // A docs push to master runs this workflow too -- it is the same gate as a
  // cut -- so the tag ref is the only thing that separates them. If a publishing
  // job loses its condition, a documentation change would tag a release with the
  // package version and upload whatever the build produced.
  it.each(PUBLISH_JOBS)('%s runs only for a v* tag', (name) => {
    expect(jobBlock(text(), name)).toContain(GATE);
  });

  // electron-builder names the assets after package.json, so a tag that does not
  // name the same version would publish files for a release page that says
  // something else. The check has to run before the publish step, not beside it.
  it('refuses a tag that does not match package.json', () => {
    const build = jobBlock(text(), 'build');
    expect(build).toMatch(
      /if \[ "v\$\{\{ steps\.version\.outputs\.version \}\}" != "\$\{\{ github\.ref_name \}\}" \]; then/,
    );
    expect(build).toContain('does not match package.json version');
    expect(build).toMatch(/exit 1/);
    const check = build.indexOf('Check the tag matches the package version');
    const publish = build.indexOf('uses: softprops/action-gh-release@');
    expect(check).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(-1);
    expect(check).toBeLessThan(publish);
  });
});
