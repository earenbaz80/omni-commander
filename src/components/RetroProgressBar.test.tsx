import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { RetroProgressBar } from './RetroProgressBar';
import { themes } from '../services/themeManager';

const theme = themes.classic_blue;

describe('RetroProgressBar', () => {
  it('renders a proportional bar with no brackets', () => {
    const { container } = render(<RetroProgressBar percent={50} theme={theme} cells={10} />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.textContent).toBe('█████░░░░░');
    expect(bar?.textContent).not.toContain('[');
    expect(bar?.textContent).not.toContain(']');
  });

  it('clamps out-of-range percentages', () => {
    const { container, rerender } = render(<RetroProgressBar percent={-20} theme={theme} cells={10} />);
    expect(container.querySelector('[role="progressbar"]')?.textContent).toBe('░░░░░░░░░░');
    rerender(<RetroProgressBar percent={420} theme={theme} cells={10} />);
    expect(container.querySelector('[role="progressbar"]')?.textContent).toBe('██████████');
  });

  it('reserves a blinking head cell while queued', () => {
    const { container } = render(<RetroProgressBar percent={0} status="queued" theme={theme} cells={10} />);
    expect(container.querySelector('[role="progressbar"]')?.textContent).toBe('█░░░░░░░░░');
  });

  it('reports the percentage to assistive technology', () => {
    const { container } = render(<RetroProgressBar percent={37} theme={theme} cells={10} />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('37');
    expect(bar?.getAttribute('aria-valuemin')).toBe('0');
    expect(bar?.getAttribute('aria-valuemax')).toBe('100');
  });

  it('auto-fits its container when no cell count is given, still bracket-free', () => {
    const { container } = render(<RetroProgressBar percent={50} theme={theme} />);
    const bar = container.querySelector('[role="progressbar"]');
    // jsdom has no layout, so the bar falls back to a sane cell count rather
    // than breaking: the contract is "no brackets, still a proportional bar".
    expect(bar?.textContent).not.toContain('[');
    expect(bar?.textContent).not.toContain(']');
    expect(bar?.textContent).toContain('█');
    expect(bar?.textContent).toContain('░');
    expect(bar?.getAttribute('aria-valuenow')).toBe('50');
  });
});
