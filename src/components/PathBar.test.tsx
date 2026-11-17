import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PathBar } from './PathBar';
import { themes } from '../services/themeManager';

/**
 * The breadcrumb is read left to right as one path, so the drive has to appear
 * once: it is the amber prefix, and the pieces after it start below the root.
 *
 * `C:\Windows` used to render `C:\` and then a `C:` button, because splitting the
 * path keeps the drive as its first segment; that button also pointed at
 * `C:\C:`, so the duplicate was not just noise, it was a dead link.
 */
const renderBar = (currentPath: string, driveRoot = 'C:\\') => {
  const onNavigate = vi.fn();
  const { container } = render(
    <PathBar
      theme={themes.classic_blue}
      lang="es"
      currentPath={currentPath}
      driveRoot={driveRoot}
      onNavigate={onNavigate}
      onGoParent={vi.fn()}
      onGoBack={vi.fn()}
      onGoForward={vi.fn()}
      canGoBack={false}
      canGoForward={false}
      onRefresh={vi.fn()}
      filterText=""
      onFilterChange={vi.fn()}
      viewMode="full"
      onChangeViewMode={vi.fn()}
      isActive
    />,
  );
  // The amber prefix is the drive; everything else in its box is the crumbs.
  const prefix = container.querySelector('span.font-bold') as HTMLElement;
  const box = prefix.parentElement as HTMLElement;
  return { onNavigate, text: box.textContent, crumbs: [...box.querySelectorAll('button')].map((b) => b.textContent) };
};

describe('PathBar breadcrumbs', () => {
  it('shows the drive once, as the prefix, and the folders below it as crumbs', () => {
    const { text, crumbs } = renderBar('C:\\Windows\\System32');

    expect(text).toBe('C:\\Windows\\System32');
    expect(crumbs).toEqual(['Windows', 'System32']);
    expect(crumbs).not.toContain('C:');
  });

  it('points each crumb at the path it names', () => {
    const { onNavigate } = renderBar('C:\\Windows\\System32');

    fireEvent.click(screen.getByText('Windows'));
    expect(onNavigate).toHaveBeenCalledWith('C:\\Windows');

    fireEvent.click(screen.getByText('System32'));
    expect(onNavigate).toHaveBeenLastCalledWith('C:\\Windows\\System32');
  });

  it('leaves the drive root as a single prefix with nothing after it', () => {
    const { text, crumbs } = renderBar('C:\\');

    expect(text).toBe('C:\\');
    expect(crumbs).toEqual([]);
  });

  it('draws an archive under the mount point that holds it', () => {
    // The archive's root is a folder of the disk, so it is a crumb like any other;
    // the levels below it are spelled the same way and stay inside the archive.
    const { crumbs, onNavigate } = renderBar('/mnt/vol/demo.zip/docs/2026', '/mnt/vol');

    expect(crumbs).toEqual(['demo.zip', 'docs', '2026']);

    fireEvent.click(screen.getByText('docs'));
    expect(onNavigate).toHaveBeenCalledWith('/mnt/vol/demo.zip/docs');
  });

  it('drops the drive name of a virtual drive too, which is longer than one letter', () => {
    const { text, crumbs } = renderBar('GD:\\proyectos\\2026', 'GD:\\');

    expect(text).toBe('GD:\\proyectos\\2026');
    expect(crumbs).toEqual(['proyectos', '2026']);
  });
});
