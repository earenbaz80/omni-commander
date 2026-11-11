import type { Meta, StoryObj } from '@storybook/react-vite';
import { KeybindingsTable } from '../components/KeybindingsTable';
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
  folderText: '#ffd700',
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
  { category: 'Function Keys', key: 'F1', description: 'Open Help', preset: 'omni' },
  { category: 'Function Keys', key: 'F2', description: 'User Menu', preset: 'omni' },
  { category: 'Function Keys', key: 'F3', description: 'View File', preset: 'omni' },
  { category: 'Function Keys', key: 'F4', description: 'Edit File', preset: 'omni' },
  { category: 'Function Keys', key: 'F5', description: 'Copy', preset: 'omni' },
  { category: 'Function Keys', key: 'F6', description: 'Move', preset: 'omni' },
  { category: 'Function Keys', key: 'F7', description: 'New Folder', preset: 'omni' },
  { category: 'Function Keys', key: 'F8', description: 'Delete', preset: 'omni' },
  { category: 'Function Keys', key: 'F9', description: 'Menu', preset: 'omni' },
  { category: 'Function Keys', key: 'F10', description: 'Quit', preset: 'omni' },
  { category: 'Navigation', key: 'Tab', description: 'Switch Panels', preset: 'omni' },
  { category: 'Navigation', key: 'Enter', description: 'Open Folder', preset: 'omni' },
  { category: 'Navigation', key: 'Backspace', description: 'Go Parent', preset: 'omni' },
  { category: 'Navigation', key: 'Ctrl+T', description: 'New Tab', preset: 'omni' },
  { category: 'Navigation', key: 'Ctrl+W', description: 'Close Tab', preset: 'omni' },
  { category: 'Selection', key: 'Space', description: 'Toggle Selection', preset: 'omni' },
  { category: 'Selection', key: 'Ctrl+A', description: 'Select All', preset: 'omni' },
  { category: 'Selection', key: '*', description: 'Invert Selection', preset: 'omni' },
];

const categories = ['Function Keys', 'Navigation', 'Selection'];
const presets = ['omni'];

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
    filterPreset: 'omni',
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
