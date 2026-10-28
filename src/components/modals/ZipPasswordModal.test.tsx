import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ZipPasswordModal } from './ZipPasswordModal';
import { themes } from '../../services/themeManager';
import { translations } from '../../i18n/translations';

const t = translations.es;

const renderModal = (props: Partial<React.ComponentProps<typeof ZipPasswordModal>> = {}) => {
  const onSubmit = props.onSubmit ?? vi.fn();
  const onClose = props.onClose ?? vi.fn();
  render(
    <ZipPasswordModal
      theme={themes.classic_blue}
      lang="es"
      fileName="copia.rar"
      onSubmit={onSubmit}
      onClose={onClose}
      {...props}
    />,
  );
  return { onSubmit, onClose };
};

afterEach(() => {
  cleanup();
});

describe('ZipPasswordModal', () => {
  it('asks for the password in the app language, naming the file', () => {
    renderModal();

    expect(screen.getByText(t.zipPassPrompt.replace('{name}', 'copia.rar'))).toBeTruthy();
    expect(screen.getByPlaceholderText(t.zipPassPlaceholder)).toBeTruthy();
    // Nothing English may leak into a Spanish frame.
    expect(screen.queryByText(/Enter password for/)).toBeNull();
    expect(screen.queryByPlaceholderText(/Archive password/)).toBeNull();
  });

  it('marks a wrong password in the same language, and only when asked to', () => {
    const { unmount } = render(
      <ZipPasswordModal
        theme={themes.classic_blue}
        lang="es"
        fileName="copia.rar"
        invalid
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(t.zipPassInvalid.replace('{name}', 'copia.rar'))).toBeTruthy();
    unmount();

    renderModal();
    expect(screen.queryByText(/Contraseña incorrecta/)).toBeNull();
  });

  it('submits what was typed when Enter is pressed, and nothing when the field is empty', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderModal();
    const input = screen.getByPlaceholderText(t.zipPassPlaceholder);

    // An empty field is not an answer: Enter must not resolve the prompt with ''.
    await user.click(input);
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();

    await user.type(input, 'omnicmd{Enter}');

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('omnicmd');
  });

  it('closes without a password when the user cancels', () => {
    const { onClose, onSubmit } = renderModal();

    // The form's own button, not the shell's close icon, which carries the same
    // label.
    fireEvent.click(screen.getByRole('button', { name: `${t.btnCancel} (Esc)` }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
