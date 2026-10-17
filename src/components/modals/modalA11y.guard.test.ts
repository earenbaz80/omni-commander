import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('src/components/modals');

const modalFiles = fs
  .readdirSync(dir)
  .filter((f) => /Modal\.tsx$/.test(f) && !f.includes('.test.'));

describe('modal accessibility guard', () => {
  it('finds the modal components', () => {
    expect(modalFiles.length).toBeGreaterThan(20);
  });

  it.each(modalFiles)('%s opts into an accessible dialog', (file) => {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    const usesShell = src.includes('<ModalShell');
    const usesHook = src.includes('useModalDialog');
    expect(usesShell || usesHook).toBe(true);
  });
});
