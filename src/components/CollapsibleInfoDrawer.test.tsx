import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { themes } from '../services/themeManager';
import type { Drive } from '../types';
import { translations } from '../i18n/translations';

const fetchSystemStats = vi.fn();

vi.mock('../services/systemStats', () => ({
  fetchSystemStats: () => fetchSystemStats(),
}));

const { CollapsibleInfoDrawer } = await import('./CollapsibleInfoDrawer');

const t = translations.es;

const drive: Drive = {
  id: 'real_C',
  letter: 'C:',
  name: 'OS',
  type: 'local',
  totalBytes: 100 * 1024 * 1024 * 1024,
  freeBytes: 40 * 1024 * 1024 * 1024,
  isMounted: true,
};

const renderDrawer = () =>
  render(
    <CollapsibleInfoDrawer
      theme={themes.classic_blue}
      lang="es"
      activeDrive={drive}
      activePath="C:\\"
      focusedItem={null}
      selectedCount={0}
      totalItemsCount={12}
      totalSelectedBytes={0}
      isAdminMode={false}
      onToggleAdminMode={() => {}}
      onLockApp={() => {}}
      isFolderProtected={false}
      onProtectFolder={() => {}}
    />,
  );

const expand = () => fireEvent.click(screen.getByTitle(t.collapseInfoPanel));

beforeEach(() => {
  fetchSystemStats.mockReset();
});

describe('CollapsibleInfoDrawer system load', () => {
  it('shows the measured CPU load, core count and memory of the machine', async () => {
    fetchSystemStats.mockResolvedValue({
      cores: 8,
      cpuPercent: 23.4,
      ramUsedBytes: 8 * 1024 * 1024 * 1024,
      ramTotalBytes: 16 * 1024 * 1024 * 1024,
    });

    renderDrawer();
    expand();

    await waitFor(() => expect(screen.getByText(`23% (8 ${t.coresLabel})`)).toBeDefined());
    expect(screen.getByText('8.00 GB / 16.00 GB')).toBeDefined();
    // The old fixed figures must be gone for good.
    expect(screen.queryByText(/14% \(16/)).toBeNull();
    expect(screen.queryByText('16.4 GB / 64 GB')).toBeNull();
  });

  it('says unknown instead of inventing numbers when the server cannot answer', async () => {
    fetchSystemStats.mockResolvedValue(null);

    renderDrawer();
    expand();

    await waitFor(() => expect(fetchSystemStats).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText('—')).toHaveLength(2));
    expect(screen.queryByText(/14% \(16/)).toBeNull();
  });

  it('does not poll while the drawer is collapsed', async () => {
    fetchSystemStats.mockResolvedValue({
      cores: 4,
      cpuPercent: 5,
      ramUsedBytes: 1024,
      ramTotalBytes: 2048,
    });

    renderDrawer();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(fetchSystemStats).not.toHaveBeenCalled();
  });
});
