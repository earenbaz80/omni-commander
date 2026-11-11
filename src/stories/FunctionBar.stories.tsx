import type { Meta, StoryObj } from '@storybook/react-vite';
import { FunctionBar, type FunctionKey } from '../components/FunctionBar';
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

const defaultKeys: FunctionKey[] = [
  { key: 'F1', label: 'helpF1', action: () => console.log('F1') },
  { key: 'F2', label: 'menuF2', action: () => console.log('F2') },
  { key: 'F3', label: 'viewF3', action: () => console.log('F3') },
  { key: 'F4', label: 'editF4', action: () => console.log('F4') },
  { key: 'F5', label: 'copyF5', action: () => console.log('F5') },
  { key: 'F6', label: 'moveF6', action: () => console.log('F6') },
  { key: 'F7', label: 'mkdirF7', action: () => console.log('F7') },
  { key: 'F8', label: 'deleteF8', action: () => console.log('F8') },
  { key: 'F9', label: 'configF9', action: () => console.log('F9') },
  { key: 'F10', label: 'quitF10', action: () => console.log('F10') },
];

const meta = {
  title: 'Design System/FunctionBar',
  component: FunctionBar,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
  argTypes: {
    keys: { control: 'object' },
    className: { control: 'text' },
  },
} satisfies Meta<typeof FunctionBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    theme: mockTheme,
    lang: 'en',
    keys: defaultKeys,
  },
};

export const WithDisabledKeys: Story = {
  args: {
    theme: mockTheme,
    lang: 'en',
    keys: [
      { key: 'F1', label: 'helpF1', action: () => console.log('F1') },
      { key: 'F2', label: 'menuF2', disabled: true },
      { key: 'F3', label: 'viewF3', action: () => console.log('F3') },
      { key: 'F4', label: 'editF4', disabled: true },
      { key: 'F5', label: 'copyF5', action: () => console.log('F5') },
    ],
  },
};

export const HiddenKeys: Story = {
  args: {
    theme: mockTheme,
    lang: 'en',
    keys: [
      { key: 'F1', label: 'helpF1', action: () => console.log('F1') },
      { key: 'F2', label: 'menuF2', visible: false },
      { key: 'F3', label: 'viewF3', action: () => console.log('F3') },
    ],
  },
};
