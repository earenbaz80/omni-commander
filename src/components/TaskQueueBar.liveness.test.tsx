import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TaskQueueBar } from './TaskQueueBar';
import { themes } from '../services/themeManager';
import { taskQueue } from '../services/taskQueueManager';
import { getTranslations } from '../i18n/translations';

// The bar asks the process whether it holds an elevated token. This build does,
// so there is nothing left for it to offer.
vi.mock('../hooks/useElevation', () => ({
  useElevation: () => ({ isElevated: true, requestElevation: async () => {} }),
}));

const t = getTranslations('es');

const failACopy = async (title: string) => {
  taskQueue.addTask('copy', title, 'demo', 0, async () => {
    throw new Error('EPERM: operation not permitted, mkdir "D:\\"');
  });
  await waitFor(() => expect(taskQueue.getTasks().find((task) => task.title === title)?.status).toBe('failed'));
};

describe('TaskQueueBar and the work that is really moving', () => {
  beforeEach(() => {
    // A task left over from the previous case would be the headline here.
    for (const task of taskQueue.getTasks()) taskQueue.cancelTask(task.id);
  });

  it('reports the failure but does not offer admin to a process that has it', async () => {
    // Hiding a failed transfer would hide an incomplete file on disk, so the
    // reason stays. What must not stay is the only way to gain a token this
    // process already holds: relaunching would restart it and lose the work.
    await failACopy('Copia muerta');

    render(<TaskQueueBar onOpenTasksModal={vi.fn()} lang="es" theme={themes.classic_blue} />);

    expect(screen.getByText(/EPERM/)).toBeTruthy();
    expect(screen.queryByText(t.runAsAdmin)).toBeNull();
  });

  it('shows the transfer that is running instead of an older one that failed', async () => {
    // Newest-first used to put the dead copy on top: the card asked for admin
    // for a file nobody was copying while the live transfer wrote behind it.
    await failACopy('Copia muerta');
    taskQueue.addTask('copy', 'Copia viva', 'demo', 1024, () => new Promise<void>(() => {}));

    render(<TaskQueueBar onOpenTasksModal={vi.fn()} lang="es" theme={themes.classic_blue} />);

    expect(screen.getByText('Copia viva')).toBeTruthy();
    expect(screen.queryByText('Copia muerta')).toBeNull();
  });
});
