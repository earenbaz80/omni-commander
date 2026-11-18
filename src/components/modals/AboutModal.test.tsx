import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AboutModal } from './AboutModal';
import { themes } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';

const t = getTranslations('es');

interface UpdateSnapshot {
  status: string;
  version: string | null;
  percent: number;
  error: string | null;
  enabled: boolean;
  channel: string;
}

function openAbout(snapshot: UpdateSnapshot) {
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    getUpdateState: async () => snapshot,
    checkForUpdates: async () => snapshot,
    downloadUpdate: async () => snapshot,
    installUpdate: async () => snapshot,
    onUpdateState: () => () => {},
  };
  render(<AboutModal theme={themes.classic_blue} lang="es" authorName="tester" onClose={vi.fn()} />);
}

const snapshot = (patch: Partial<UpdateSnapshot>): UpdateSnapshot => ({
  status: 'idle',
  version: null,
  percent: 0,
  error: null,
  enabled: true,
  channel: 'stable',
  ...patch,
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('about box update row', () => {
  it('keeps the restart and says why the check after it failed', async () => {
    openAbout(
      snapshot({ status: 'downloaded', version: '9.9.9', percent: 100, error: 'net::ERR_INTERNET_DISCONNECTED' }),
    );

    // The reason the check failed belongs next to the state, not instead of it:
    // the download is still there and the box still offers the restart.
    expect(await screen.findByText(t.updateReadyToInstall)).toBeTruthy();
    expect(await screen.findByText(/net::ERR_INTERNET_DISCONNECTED/)).toBeTruthy();
    expect(screen.getByRole('button', { name: t.updateInstall })).toBeTruthy();
  });
});
