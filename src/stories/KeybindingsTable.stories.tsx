import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { KeybindingsTable } from '../components/KeybindingsTable';
import { ThemeConfig } from '../services/themeManager';

const mockTheme: ThemeConfig = {
  id: 'classic_blue',
  nameKey: 'themeNorton',
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

const sampleKeybindings = [
  { category: 'Function Keys', key: 'F1', description: 'Open Help', preset: 'norton' },
  { category: 'Function Keys', key: 'F2', description: 'User Menu', preset: 'norton' },
  { category: 'Function Keys', key: 'F3', description: 'View File', preset: 'norton' },
  { category: 'Function Keys', key: 'F4', description: 'Edit File', preset: 'norton' },
  { category: 'Function Keys', key: 'F5', description: 'Copy', preset: 'norton' },
  { category: 'Function Keys', key: 'F6', description: 'Move', preset: 'norton' },
  { category: 'Function Keys', key: 'F7', description: 'New Folder', preset: 'norton' },
  { category: 'Function Keys', key: 'F8', description: 'Delete', preset: 'norton' },
  { category: 'Function Keys', key: 'F9', description: 'Menu', preset: 'norton' },
  { category: 'Function Keys', key: 'F10', description: 'Quit', preset: 'norton' },
  { category: 'Navigation', key: 'Tab', description: 'Switch Panels', preset: 'norton' },
  { category: 'Navigation', key: 'Enter', description: 'Open Folder', preset: 'norton' },
  { category: 'Navigation', key: 'Backspace', description: 'Go Parent', preset: 'norton' },
  { category: 'Navigation', key: 'Ctrl+T', description: 'New Tab', preset: 'norton' },
  { category: 'Navigation', key: 'Ctrl+W', description: 'Close Tab', preset: 'norton' },
  { category: 'Selection', key: 'Space', description: 'Toggle Selection', preset: 'norton' },
  { category: 'Selection', key: 'Ctrl+A', description: 'Select All', preset: 'norton' },
  { category: 'Selection', key: '*', description: 'Invert Selection', preset: 'norton' },
];

const categories = ['Function Keys', 'Navigation', 'Selection'];
const presets = ['norton', 'totalcmd', 'midnight'];

const meta = {
  title: 'Design System/KeybindingsTable',
  component: KeybindingsTable,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  argTypes: {
    filterPreset: { control: 'select', options: ['', ...presets] },
  },
} satisfies Meta<typeof KeybindingsTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    theme: mockTheme,
    lang: 'en',
    keybindings: sampleKeybindings,
    categories,
    presets,
  },
};

export const WithPresetFilter: Story = {
  args: {
    theme: mockTheme,
    lang: 'en',
    keybindings: sampleKeybindings,
    categories,
    filterPreset: 'norton',
    presets,
    onFilterChange: (preset: string) => console.log('Preset changed:', preset),
  },
};

export const EmptyResults: Story = {
  args: {
    theme: mockTheme,
    lang: 'en',
    keybindings: [],
    categories,
    presets,
  },
};
