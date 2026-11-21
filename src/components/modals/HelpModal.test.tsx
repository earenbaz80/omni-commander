import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { themes } from '../../services/themeManager';
import { translations } from '../../i18n/translations';
import { HelpModal } from './HelpModal';

describe('HelpModal footer', () => {
  it('prints the version the package was built from, not a fixed one', () => {
    render(<HelpModal theme={themes.classic_blue} lang="es" onClose={() => {}} />);

    expect(screen.getByText(`OmniCommander Pro • Documentación v${__APP_VERSION__}`)).toBeDefined();
    // The literal that no build ever produced must not come back.
    expect(screen.queryByText(/v5\.50/)).toBeNull();
    expect(translations.es.helpFooter).not.toMatch(/v\d/);
  });

  it('documents the opening rules on the dual panel tab', () => {
    render(<HelpModal theme={themes.classic_blue} lang="es" onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: translations.es.helpTabDualPanel }));

    expect(screen.getByText(translations.es.helpOpenTitle)).toBeDefined();
    expect(screen.getByText(translations.es.helpOpenDesc)).toBeDefined();
  });
});
