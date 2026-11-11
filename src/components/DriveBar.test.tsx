import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { DriveBar } from './DriveBar';
import { themes } from '../services/themeManager';
import type { Drive } from '../types';

const theme = themes.classic_blue;

/** A drive whose used share is the number the meter has to classify. */
function driveUsedAt(percent: number): Drive {
  const totalBytes = 100 * 1024 ** 3;
  return {
    id: 'C:',
    letter: 'C:',
    name: 'System',
    type: 'local',
    totalBytes,
    freeBytes: totalBytes * (1 - percent / 100),
    isMounted: true,
  };
}

function renderMeter(percent: number): HTMLElement {
  const drive = driveUsedAt(percent);
  const { container } = render(
    <DriveBar
      theme={theme}
      drives={[drive]}
      currentDriveId={drive.id}
      onSelectDrive={() => {}}
      panelSide="left"
      isActive
    />,
  );
  return container;
}

const BANDS = ['nc-danger-fill', 'nc-warn-fill', 'nc-ok-fill'];

function bandOf(container: HTMLElement): string | null {
  return BANDS.find((band) => container.querySelector(`.${band}`)) ?? null;
}

describe('DriveBar network drives', () => {
  it('keeps a mapped drive whose server is away on the bar', () => {
    const local = driveUsedAt(20);
    const mapped: Drive = {
      id: 'Z:',
      letter: 'Z:',
      name: 'NAS media',
      type: 'network',
      driveKind: 'network',
      totalBytes: 0,
      freeBytes: 0,
      isMounted: false,
    };
    const { getByText } = render(
      <DriveBar
        theme={theme}
        drives={[local, mapped]}
        currentDriveId={local.id}
        onSelectDrive={() => {}}
        panelSide="left"
        isActive
      />,
    );
    expect(getByText('[Z:]')).toBeTruthy();
  });
});

describe('DriveBar disk meter', () => {
  it('reads a low usage as healthy', () => {
    expect(bandOf(renderMeter(20))).toBe('nc-ok-fill');
  });

  it('reads a 70 percent drive as a caution', () => {
    expect(bandOf(renderMeter(70))).toBe('nc-warn-fill');
  });

  it('reads a nearly full drive as a danger', () => {
    expect(bandOf(renderMeter(92))).toBe('nc-danger-fill');
  });
});
