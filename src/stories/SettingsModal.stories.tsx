import type { Meta, StoryObj } from '@storybook/react-vite';
import { UserSettings } from '../types';
import { ThemeConfig } from '../services/themeManager';
import { SettingsModal } from '../components/modals/SettingsModal';

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

const defaultSettings: UserSettings = {
  theme: 'classic_blue',
  language: 'en',
  showToolbar: true,
  showCollapsibleInfoDrawer: true,
  crtEffectEnabled: true,
  crtIntensity: 'classic',
  blinkingCursorEnabled: true,
  cursorBlinkColor: 'cyan',
  fileSelectorColor: 'blue',
  showClock: true,
  clockPosition: 'header',
  showHoverTooltips: true,
  showImageHoverThumbnails: true,
  confirmDelete: true,
  confirmCopyOverwrite: true,
  showHiddenFiles: false,
  showSystemFiles: false,
  useRecycleBin: true,
  soundEffects: true,
  appLockEnabled: false,
  // Missing fields
  retroDosBorders: false,
  fontSize: 'normal',
  fontFamily: 'mono',
  splitLayout: 'horizontal',
  dualPaneRatio: 50,
  quickPreviewAutoPlay: false,
  showCommandLine: true,
  showFunctionBar: true,
  showDriveButtons: true,
  authorName: 'OmniCommander Pro',
  protectedFolders: {},
  customShortcuts: {},
  appUsername: 'admin',
  appPasswordHash: '',
  appPasswordSalt: '',
} as UserSettings;

const meta = {
  title: 'Design System/SettingsModal',
  component: SettingsModal,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof SettingsModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    theme: mockTheme,
    lang: 'en',
    settings: defaultSettings,
    onUpdateSettings: (newSettings: Partial<UserSettings>) => {
      console.log('Settings updated:', newSettings);
    },
    onClose: () => {
      console.log('Modal closed');
    },
  },
};

export const WithAppLock: Story = {
  args: {
    theme: mockTheme,
    lang: 'en',
    settings: {
      ...defaultSettings,
      appLockEnabled: true,
      appUsername: 'admin',
      appPasswordHash: 'hashed_password',
      appPasswordSalt: 'salt_value',
    },
    onUpdateSettings: (newSettings: Partial<UserSettings>) => {
      console.log('Settings updated:', newSettings);
    },
    onClose: () => {
      console.log('Modal closed');
    },
  },
};
