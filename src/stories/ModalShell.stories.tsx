import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import ModalShell from '../components/ModalShell';
import { ThemeConfig } from '../services/themeManager';

const mockTheme: ThemeConfig = {
  id: 'classic_blue',
  nameKey: 'themeOmniClassic',
  bgApp: '#000084',
  bgPanel: '#0000a8',
  bgPanelInactive: '#000084',
  borderPanel: '#55ffff',
  borderFocus: '#ffffff',
  headerBg: '#55ffff',
  headerText: '#000000',
  itemText: '#ffffff',
  dirText: '#55ffff',
  exeText: '#55ff55',
  zipText: '#ff55ff',
  docText: '#ffff55',
  mediaText: '#55ffff',
  selectedText: '#000000',
  selectedBg: '#55ffff',
  cursorBg: '#55ffff',
  cursorText: '#000000',
  statusBg: '#000000',
  statusText: '#55ffff',
  fkeyNumBg: '#000000',
  fkeyNumText: '#55ffff',
  fkeyLabelBg: '#55ffff',
  fkeyLabelText: '#000000',
  promptBg: '#000000',
  promptText: '#55ffff',
  modalBg: '#0000a8',
  modalBorder: '#55ffff',
  modalHeaderBg: '#55ffff',
  modalHeaderText: '#000000',
  accent: '#55ffff',
  accentWarn: '#ffb000',
  accentDanger: '#ff5555',
  accentOk: '#55ff55',
  overlay: '#00000099',
  radius: '0',
  shadow: 'none',
  isRetro: true,
};

const meta = {
  title: 'Design System/ModalShell',
  component: ModalShell,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    title: { control: 'text' },
    onClose: { action: 'closed' },
    closeButtonLabel: { control: 'text' },
    overlay: { control: 'boolean' },
  },
} satisfies Meta<typeof ModalShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: 'Modal Title',
    theme: mockTheme,
    onClose: () => {},
    closeButtonLabel: 'Close',
    children: (
      <div className="font-mono select-none p-[var(--space-4)]">
        <p className="text-[var(--fs-sm)]">Modal content goes here.</p>
      </div>
    ),
  },
};

export const WithOverlay: Story = {
  args: {
    title: 'Overlay Modal',
    theme: mockTheme,
    onClose: () => {},
    closeButtonLabel: 'Close',
    overlay: true,
    children: (
      <div className="font-mono select-none p-[var(--space-4)]">
        <p className="text-[var(--fs-sm)]">This modal has a dark overlay behind it.</p>
      </div>
    ),
  },
};
