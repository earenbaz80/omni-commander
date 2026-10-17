import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Boom({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) throw new Error('boom render');
  return <p>contenido-ok</p>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children normally when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>contenido-ok</p>
      </ErrorBoundary>
    );
    expect(screen.getByText('contenido-ok')).toBeTruthy();
  });

  it('shows an alert panel instead of crashing when a child throws', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/boom render/)).toBeTruthy();
    expect(screen.queryByText('contenido-ok')).toBeNull();
  });

  it('recovers on retry once the throwing condition is fixed', () => {
    const { rerender } = render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeTruthy();

    rerender(
      <ErrorBoundary>
        <Boom shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(screen.getByText('contenido-ok')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers a reload action in the fallback panel', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByRole('button', { name: /recargar/i })).toBeTruthy();
  });
});
