import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('src/components/modals');

const modalFiles = fs.readdirSync(dir).filter((f) => /Modal\.tsx$/.test(f) && !f.includes('.test.'));

describe('modal accessibility guard', () => {
  it('finds the modal components', () => {
    expect(modalFiles.length).toBeGreaterThan(20);
  });

  it.each(modalFiles)('%s opts into an accessible dialog', (file) => {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    const usesShell = src.includes('<ModalShell');
    const usesHook = /const\s+\w+\s*=\s*useModalDialog\s*[<(]/.test(src);
    expect(usesShell || usesHook).toBe(true);
  });

  // `ModalShell` already names its panel, marks it modal and traps focus. A
  // window that asks for those a second time puts a `role="dialog"` inside the
  // one the shell published, and a screen reader announces the whole prompt
  // twice. That is what every wrapped modal here used to do.
  it.each(modalFiles)('%s leaves the dialog semantics to a single owner', (file) => {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    const usesShell = src.includes('<ModalShell');
    const claimsDialog = /const\s+\w+\s*=\s*useModalDialog\s*[<(]/.test(src);
    expect(usesShell && claimsDialog).toBe(false);
  });
});
