import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { themes } from '../services/themeManager';
import type { Drive } from '../types';
import { translations } from '../i18n/translations';

const fetchSystemStats = vi.fn();
const fetchShareStatus = vi.fn();

vi.mock('../services/systemStats', () => ({
  fetchSystemStats: () => fetchSystemStats(),
}));

vi.mock('../services/shareStatus', () => ({
  fetchShareStatus: () => fetchShareStatus(),
}));

const { CollapsibleInfoDrawer } = await import('./CollapsibleInfoDrawer');

const t = translations.es;

const drive: Drive = {
  id: 'real_C',
  root: 'C:\\',
  letter: 'C:',
  name: 'OS',
  type: 'local',
  totalBytes: 100 * 1024 * 1024 * 1024,
  freeBytes: 40 * 1024 * 1024 * 1024,
  isMounted: true,
};

/** Mapped drive whose server is away: no size at all. */
const sizelessDrive: Drive = {
  ...drive,
  id: 'network_Z',
  root: 'Z:\\',
  letter: 'Z:',
  name: 'share',
  type: 'network',
  totalBytes: 0,
  freeBytes: 0,
  isMounted: false,
};

const idleShare = {
  active: false,
  folder: null,
  port: null,
  token: null,
  startedAt: null,
  urls: [],
};

const renderDrawer = (activeDrive: Drive = drive) =>
  render(
    <CollapsibleInfoDrawer
      theme={themes.classic_blue}
      lang="es"
      activeDrive={activeDrive}
      activePath={activeDrive.root}
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
  fetchShareStatus.mockReset();
  fetchShareStatus.mockResolvedValue(idleShare);
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
    expect(fetchShareStatus).not.toHaveBeenCalled();
  });
});

describe('CollapsibleInfoDrawer sharing status', () => {
  it('reports the port the server is really serving on', async () => {
    fetchShareStatus.mockResolvedValue({ ...idleShare, active: true, folder: '/srv/out', port: 8787 });

    renderDrawer();
    expand();

    await waitFor(() => expect(screen.getByText('Activa · puerto 8787')).toBeDefined());
    // The fixed "Blocked" claim is gone.
    expect(screen.queryByText('Bloqueado')).toBeNull();
  });

  it('says the share is off when the server says nothing is served', async () => {
    renderDrawer();
    expand();

    await waitFor(() => expect(screen.getByText(t.shareIdle)).toBeDefined());
  });

  it('says unknown, not "off", when the server cannot answer', async () => {
    fetchShareStatus.mockResolvedValue(null);

    renderDrawer();
    expand();

    await waitFor(() => expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3));
    expect(screen.queryByText(t.shareIdle)).toBeNull();
  });
});

describe('CollapsibleInfoDrawer capacity', () => {
  it('prints no percentage and no NaN when the drive reports no size', async () => {
    renderDrawer(sizelessDrive);
    expand();

    await waitFor(() => expect(fetchShareStatus).toHaveBeenCalled());
    expect(screen.queryByText(/NaN/)).toBeNull();
    // Total, free and used are unknown rather than a made-up 0 B.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByText(/^0 B$/)).toBeNull();
  });

  it('keeps the percentage of a drive that does report its size', async () => {
    renderDrawer();
    expand();

    await waitFor(() => expect(fetchShareStatus).toHaveBeenCalled());
    expect(screen.getByText('60.00 GB (60%)')).toBeDefined();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });
});
