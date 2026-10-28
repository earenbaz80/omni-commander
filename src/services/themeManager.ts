import { ThemeId } from '../types';

export interface ThemeConfig {
  id: ThemeId;
  nameKey: string;
  bgApp: string;
  bgPanel: string;
  bgPanelInactive: string;
  borderPanel: string;
  borderFocus: string;
  headerBg: string;
  headerText: string;
  itemText: string;
  dirText: string;
  exeText: string;
  zipText: string;
  docText: string;
  mediaText: string;
  selectedText: string;
  selectedBg: string;
  cursorBg: string;
  cursorText: string;
  statusBg: string;
  statusText: string;
  fkeyNumBg: string;
  fkeyNumText: string;
  fkeyLabelBg: string;
  fkeyLabelText: string;
  promptBg: string;
  promptText: string;
  modalBg: string;
  modalBorder: string;
  modalHeaderBg: string;
  modalHeaderText: string;
  accent: string;
  accentWarn: string;
  accentDanger: string;
  accentOk: string;
  overlay: string;
  radius: string;
  shadow: string;
  isRetro: boolean;
}

const classicBlueConfig: ThemeConfig = {
  id: 'classic_blue',
  nameKey: 'themeOmniClassic',
  bgApp: '#000084', // Classic DOS Blue
  bgPanel: '#0000a8',
  bgPanelInactive: '#000084',
  borderPanel: '#55ffff', // Cyan double border
  borderFocus: '#ffffff',
  headerBg: '#00aaaa',
  headerText: '#000000',
  itemText: '#55ffff', // Cyan text
  dirText: '#ffffff', // Bold white for directories
  exeText: '#55ff55', // Bright green for executables
  zipText: '#ff55ff', // Magenta for archives
  docText: '#ffff55', // Yellow for docs
  mediaText: '#ffaa00',
  selectedText: '#ffff55', // Yellow for selected
  selectedBg: '#000054',
  cursorBg: '#00aaaa', // Cyan highlight bar
  cursorText: '#000000',
  statusBg: '#000084',
  statusText: '#ffffff',
  fkeyNumBg: '#000000',
  fkeyNumText: '#ffffff',
  fkeyLabelBg: '#00aaaa',
  fkeyLabelText: '#000000',
  promptBg: '#000000',
  promptText: '#ffffff',
  modalBg: '#0000a8',
  modalBorder: '#ffffff',
  modalHeaderBg: '#00aaaa',
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

const retroGrayConfig: ThemeConfig = {
  id: 'retro_gray',
  nameKey: 'themeOmniRetro',
  bgApp: '#242a35',
  bgPanel: '#1e222b',
  bgPanelInactive: '#181b22',
  borderPanel: '#3d4659',
  borderFocus: '#38bdf8',
  headerBg: '#2d3748',
  headerText: '#f1f5f9',
  itemText: '#cbd5e1',
  dirText: '#60a5fa',
  exeText: '#4ade80',
  zipText: '#c084fc',
  docText: '#fde047',
  mediaText: '#fb923c',
  selectedText: '#f87171',
  selectedBg: '#334155',
  cursorBg: '#0284c7',
  cursorText: '#ffffff',
  statusBg: '#1e222b',
  statusText: '#94a3b8',
  fkeyNumBg: '#0f172a',
  fkeyNumText: '#38bdf8',
  fkeyLabelBg: '#334155',
  fkeyLabelText: '#f8fafc',
  promptBg: '#0f172a',
  promptText: '#f8fafc',
  modalBg: '#1e293b',
  modalBorder: '#475569',
  modalHeaderBg: '#334155',
  modalHeaderText: '#f8fafc',
  accent: '#38bdf8',
  accentWarn: '#f6e05e',
  accentDanger: '#f87171',
  accentOk: '#34d399',
  overlay: '#00000088',
  radius: '0',
  shadow: 'none',
  isRetro: false,
};

/**
 * Theme names that earlier builds wrote to saved settings. They are not themes
 * of their own: each one is the same palette under its old name, so a stored
 * value is translated on load. Without that, the settings would keep a name
 * that no longer matches any theme and the theme menu would show no selection.
 */
const LEGACY_THEME_IDS: Record<string, ThemeId> = {
  norton_classic: 'classic_blue',
  total_commander: 'retro_gray',
};

/**
 * Current id for a theme name saved by any version, or the default theme when
 * the value is not a string or names a theme that no longer exists.
 */
export function migrateThemeId(savedId: unknown): ThemeId {
  if (typeof savedId === 'string') {
    const id = LEGACY_THEME_IDS[savedId] ?? savedId;
    if (id in themes) return id as ThemeId;
  }
  return 'classic_blue';
}

export const themes: Record<ThemeId, ThemeConfig> = {
  classic_blue: classicBlueConfig,
  retro_gray: retroGrayConfig,
  midnight_amber: {
    id: 'midnight_amber',
    nameKey: 'themeMidnight',
    bgApp: '#0d0800',
    bgPanel: '#150d00',
    bgPanelInactive: '#0d0800',
    borderPanel: '#ffb000',
    borderFocus: '#ffd266',
    headerBg: '#ffb000',
    headerText: '#0d0800',
    itemText: '#ffb000',
    dirText: '#ffffff',
    exeText: '#ffe082',
    zipText: '#ff9100',
    docText: '#ffc107',
    mediaText: '#ffaa00',
    selectedText: '#ffffff',
    selectedBg: '#3e2400',
    cursorBg: '#ffb000',
    cursorText: '#0d0800',
    statusBg: '#150d00',
    statusText: '#ffb000',
    fkeyNumBg: '#000000',
    fkeyNumText: '#ffb000',
    fkeyLabelBg: '#3e2400',
    fkeyLabelText: '#ffb000',
    promptBg: '#000000',
    promptText: '#ffb000',
    modalBg: '#150d00',
    modalBorder: '#ffb000',
    modalHeaderBg: '#ffb000',
    modalHeaderText: '#000000',
    accent: '#ffb000',
    accentWarn: '#ffd266',
    accentDanger: '#ff8c42',
    accentOk: '#a3e4d7',
    overlay: '#00000099',
    radius: '0',
    shadow: 'none',
    isRetro: true,
  },
  matrix_green: {
    id: 'matrix_green',
    nameKey: 'themeMatrix',
    bgApp: '#040d06',
    bgPanel: '#081a0c',
    bgPanelInactive: '#040d06',
    borderPanel: '#00ff66',
    borderFocus: '#80ffaa',
    headerBg: '#00ff66',
    headerText: '#040d06',
    itemText: '#00ff66',
    dirText: '#ffffff',
    exeText: '#a3ff70',
    zipText: '#00e5ff',
    docText: '#ccff00',
    mediaText: '#38ef7d',
    selectedText: '#ffff00',
    selectedBg: '#0f3d17',
    cursorBg: '#00ff66',
    cursorText: '#040d06',
    statusBg: '#081a0c',
    statusText: '#00ff66',
    fkeyNumBg: '#000000',
    fkeyNumText: '#00ff66',
    fkeyLabelBg: '#0f3d17',
    fkeyLabelText: '#00ff66',
    promptBg: '#000000',
    promptText: '#00ff66',
    modalBg: '#081a0c',
    modalBorder: '#00ff66',
    modalHeaderBg: '#00ff66',
    modalHeaderText: '#040d06',
    accent: '#00ff66',
    accentWarn: '#38ef7d',
    accentDanger: '#f87171',
    accentOk: '#a3e4d7',
    overlay: '#00000088',
    radius: '0',
    shadow: 'none',
    isRetro: true,
  },
  windows11_dark: {
    id: 'windows11_dark',
    nameKey: 'themeWin11Dark',
    bgApp: '#18181b',
    bgPanel: '#202024',
    bgPanelInactive: '#18181b',
    borderPanel: '#27272a',
    borderFocus: '#60a5fa',
    headerBg: '#27272a',
    headerText: '#f4f4f5',
    itemText: '#e4e4e7',
    dirText: '#93c5fd',
    exeText: '#86efac',
    zipText: '#d8b4fe',
    docText: '#fef08a',
    mediaText: '#fdba74',
    selectedText: '#fca5a5',
    selectedBg: '#3f3f46',
    cursorBg: '#2563eb',
    cursorText: '#ffffff',
    statusBg: '#18181b',
    statusText: '#a1a1aa',
    fkeyNumBg: '#09090b',
    fkeyNumText: '#60a5fa',
    fkeyLabelBg: '#27272a',
    fkeyLabelText: '#f4f4f5',
    promptBg: '#09090b',
    promptText: '#f4f4f5',
    modalBg: '#27272a',
    modalBorder: '#3f3f46',
    modalHeaderBg: '#18181b',
    modalHeaderText: '#f4f4f5',
    accent: '#3b82f6',
    accentWarn: '#a5f3fc',
    accentDanger: '#f87171',
    accentOk: '#a3e4d7',
    overlay: '#00000088',
    radius: '0',
    shadow: 'none',
    isRetro: false,
  },
  windows11_light: {
    id: 'windows11_light',
    nameKey: 'themeWin11Light',
    bgApp: '#f1f5f9',
    bgPanel: '#ffffff',
    bgPanelInactive: '#f8fafc',
    borderPanel: '#cbd5e1',
    borderFocus: '#2563eb',
    headerBg: '#e2e8f0',
    headerText: '#0f172a',
    itemText: '#1e293b',
    dirText: '#1d4ed8',
    exeText: '#15803d',
    zipText: '#7e22ce',
    docText: '#a16207',
    mediaText: '#c2410c',
    selectedText: '#b91c1c',
    selectedBg: '#e2e8f0',
    cursorBg: '#3b82f6',
    cursorText: '#ffffff',
    statusBg: '#f1f5f9',
    statusText: '#475569',
    fkeyNumBg: '#e2e8f0',
    fkeyNumText: '#1d4ed8',
    fkeyLabelBg: '#cbd5e1',
    fkeyLabelText: '#0f172a',
    promptBg: '#ffffff',
    promptText: '#0f172a',
    modalBg: '#ffffff',
    modalBorder: '#cbd5e1',
    modalHeaderBg: '#f1f5f9',
    modalHeaderText: '#0f172a',
    accent: '#2563eb',
    accentWarn: '#c6f1ff',
    accentDanger: '#f87171',
    accentOk: '#a3e4d7',
    overlay: '#00000088',
    radius: '0',
    shadow: 'none',
    isRetro: false,
  },
  dracula_retro: {
    id: 'dracula_retro',
    nameKey: 'themeDracula',
    bgApp: '#1e1f29',
    bgPanel: '#282a36',
    bgPanelInactive: '#1e1f29',
    borderPanel: '#6272a4',
    borderFocus: '#bd93f9',
    headerBg: '#44475a',
    headerText: '#f8f8f2',
    itemText: '#f8f8f2',
    dirText: '#8be9fd',
    exeText: '#50fa7b',
    zipText: '#ff79c6',
    docText: '#f1fa8c',
    mediaText: '#ffb86c',
    selectedText: '#ff5555',
    selectedBg: '#44475a',
    cursorBg: '#bd93f9',
    cursorText: '#282a36',
    statusBg: '#1e1f29',
    statusText: '#6272a4',
    fkeyNumBg: '#1e1f29',
    fkeyNumText: '#bd93f9',
    fkeyLabelBg: '#44475a',
    fkeyLabelText: '#f8f8f2',
    promptBg: '#191a21',
    promptText: '#f8f8f2',
    modalBg: '#282a36',
    modalBorder: '#6272a4',
    modalHeaderBg: '#44475a',
    modalHeaderText: '#f8f8f2',
    accent: '#bd93f9',
    accentWarn: '#c6f1ff',
    accentDanger: '#f87171',
    accentOk: '#a3e4d7',
    overlay: '#00000088',
    radius: '0',
    shadow: 'none',
    isRetro: false,
  },
  solarized_dark: {
    id: 'solarized_dark',
    nameKey: 'themeSolarized',
    bgApp: '#00212b',
    bgPanel: '#002b36',
    bgPanelInactive: '#00212b',
    borderPanel: '#073642',
    borderFocus: '#268bd2',
    headerBg: '#073642',
    headerText: '#93a1a1',
    itemText: '#839496',
    dirText: '#268bd2',
    exeText: '#859900',
    zipText: '#d33682',
    docText: '#b58900',
    mediaText: '#cb4b16',
    selectedText: '#dc322f',
    selectedBg: '#073642',
    cursorBg: '#2aa198',
    cursorText: '#002b36',
    statusBg: '#00212b',
    statusText: '#586e75',
    fkeyNumBg: '#001e26',
    fkeyNumText: '#268bd2',
    fkeyLabelBg: '#073642',
    fkeyLabelText: '#93a1a1',
    promptBg: '#001e26',
    promptText: '#839496',
    modalBg: '#002b36',
    modalBorder: '#073642',
    modalHeaderBg: '#073642',
    modalHeaderText: '#93a1a1',
    accent: '#268bd2',
    accentWarn: '#b58900',
    accentDanger: '#dc322f',
    accentOk: '#859900',
    overlay: '#00000077',
    radius: '0',
    shadow: 'none',
    isRetro: false,
  },
};
