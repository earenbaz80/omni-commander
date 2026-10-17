import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TaskQueueBar } from './TaskQueueBar';

describe('TaskQueueBar accessibility', () => {
  it('gives the collapse toggle a descriptive name and expanded state', () => {
    render(<TaskQueueBar onOpenTasksModal={vi.fn()} lang="es" />);

    const toggle = screen.getByRole('button', { name: 'Contraer cola de tareas' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });
});
