import type { Meta, StoryObj } from '@storybook/react-vite';
import { FileListStatusBar } from '../components/FileListStatusBar';
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

const meta = {
  title: 'Design System/FileListStatusBar',
  component: FileListStatusBar,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
  args: {
    theme: mockTheme,
    totalFiles: 1247,
    totalDirs: 86,
    selectedCount: 3,
    selectedBytes: 153600,
    totalBytes: 85000000,
    filesCountLabel: 'files',
    dirsCountLabel: 'dirs',
    selectedCountLabel: 'selected',
  },
} satisfies Meta<typeof FileListStatusBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NothingSelected: Story = {
  args: { selectedCount: 0, selectedBytes: 0 },
};

export const ManySelected: Story = {
  args: { selectedCount: 42, selectedBytes: 2147483648 },
};
