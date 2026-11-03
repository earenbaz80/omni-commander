import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { CalculatorModal } from './CalculatorModal';
import { ThemeConfig } from '../../services/themeManager';

const mockTheme = {
  overlay: '#00000088',
  modalBg: '#f5f5f5',
  modalBorder: '#cccccc',
  modalHeaderBg: '#ffffff',
  modalHeaderText: '#000000',
  isRetro: false,
} as ThemeConfig;

const open = () => render(<CalculatorModal theme={mockTheme} lang="es" onClose={() => {}} />);

beforeEach(() => {
  localStorage.clear();
});

describe('CalculatorModal history', () => {
  it('folds the history away and brings it back', () => {
    open();
    const toggle = screen.getByRole('button', { name: /Historial/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('#calc-history')).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('#calc-history')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('#calc-history')).toBeTruthy();
  });

  it('keeps a saved calculation ready to reuse while the panel is open', () => {
    localStorage.setItem('omni.calculator.history', JSON.stringify([{ expression: '2+2', result: '4' }]));
    open();

    expect(screen.getByText('2+2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Historial/ }));
    expect(screen.queryByText('2+2')).toBeNull();

    // Folding the panel does not empty the history behind it.
    fireEvent.click(screen.getByRole('button', { name: /Historial/ }));
    expect(screen.getByText('2+2')).toBeTruthy();
  });
});
