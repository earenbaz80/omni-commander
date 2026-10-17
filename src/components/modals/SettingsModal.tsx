import React from 'react';
import { ModalShell } from '../ModalShell';
import {
  Settings,
  Palette,
  Globe,
  Volume2,
  Sliders,
  Check,
  ChevronDown,
  Monitor,
  Keyboard,
  Lock
} from 'lucide-react';
import { UserSettings, ThemeId, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';
import { createPasswordRecord } from '../../services/appLock';

interface SettingsModalProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  settings: UserSettings;
  onUpdateSettings: (newSettings: Partial<UserSettings>) => void;
  onClose: () => void;
}

const LANGUAGES: { code: LanguageCode; label: string }[] = [
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'pt', label: 'Português' },
  { code: 'it', label: 'Italiano' },
  { code: 'ru', label: 'Русский' },
  { code: 'ja', label: '日本語' },
];

interface CollapsibleSectionProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  icon,
  title,
  subtitle,
  open,
  onToggle,
  children
}) => (
  <div className="rounded border border-white/10 overflow-hidden bg-black/20">
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="w-full flex items-center gap-2 px-2.5 py-2 cursor-pointer text-left hover:bg-white/5 transition-colors"
    >
      <span className="text-amber-300 shrink-0">{icon}</span>
      <span className="font-bold text-amber-300 uppercase tracking-wider text-[11px] flex-1 truncate">
        {title}
      </span>
      {subtitle && (
        <span className="text-[10px] opacity-60 truncate max-w-[45%] text-right shrink-0">{subtitle}</span>
      )}
      <ChevronDown
        className={`w-3.5 h-3.5 shrink-0 opacity-70 transition-transform ${open ? 'rotate-180' : ''}`}
      />
    </button>
    {open && (
      <div className="px-2.5 pb-2.5 pt-2 space-y-2 border-t border-white/10">{children}</div>
    )}
  </div>
);

export const SettingsModal: React.FC<SettingsModalProps> = ({
  theme,
  lang,
  settings,
  onUpdateSettings,
  onClose
}) => {
  const t = getTranslations(lang);

  const keybindingPresets = [
    { id: 'norton', name: 'Norton Commander', desc: t.settingsKeybindNortonDesc },
    { id: 'totalcmd', name: 'Total Commander', desc: t.settingsKeybindTotalCmdDesc },
    { id: 'midnight', name: 'Midnight Commander', desc: t.settingsKeybindMidnightDesc },
  ];

  const [openSections, setOpenSections] = React.useState<Record<string, boolean>>({});
  const [newPassword, setNewPassword] = React.useState('');
  const toggleSection = (id: string) =>
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));

  const themeList: { id: ThemeId; name: string }[] = [
    { id: 'classic_blue', name: t.themeNorton },
    { id: 'midnight_amber', name: t.themeMidnight },
    { id: 'matrix_green', name: t.themeMatrix },
    { id: 'retro_gray', name: t.themeTotalCmd },
    { id: 'windows11_dark', name: 'Windows 11 Fluent Dark' },
    { id: 'windows11_light', name: 'Windows 11 Fluent Light' },
    { id: 'dracula_retro', name: 'Dracula Retro Cyberpunk' },
    { id: 'solarized_dark', name: 'Solarized Dark Pro' },
  ];

  const currentThemeName = themeList.find((th) => th.id === settings.theme)?.name;
  const currentLangLabel = LANGUAGES.find((l) => l.code === settings.language)?.label;

  return (
    <ModalShell
      label={t.settingsTitle}
      panelClassName="w-full max-w-2xl max-h-[90vh] flex flex-col rounded shadow-2xl border text-xs overflow-hidden"
      panelStyle={{
        backgroundColor: theme.modalBg,
        borderColor: theme.modalBorder,
        color: theme.itemText
      }}
    >
        <div
          className="flex items-center justify-between px-3 py-2 border-b font-bold shrink-0"
          style={{
            backgroundColor: theme.modalHeaderBg,
            color: theme.modalHeaderText,
            borderColor: theme.modalBorder
          }}
        >
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4" />
            <span>{t.settingsTitle}</span>
          </div>
          <button onClick={onClose} aria-label={t.btnClose} title={t.btnClose} className="px-2 py-0.5 bg-black/20 hover:bg-black/40 rounded text-xs cursor-pointer font-bold">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {/* Theme Selection */}
          <CollapsibleSection
            icon={<Palette className="w-3.5 h-3.5" />}
            title={t.settingsTheme}
            subtitle={currentThemeName}
            open={!!openSections.theme}
            onToggle={() => toggleSection('theme')}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {themeList.map((th) => {
                const isSelected = settings.theme === th.id;
                return (
                  <button
                    key={th.id}
                    onClick={() => {
                      soundManager.playKeyTick();
                      onUpdateSettings({ theme: th.id });
                    }}
                    className={`p-2 rounded text-left border flex items-center justify-between cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-amber-400 text-black border-amber-300 font-bold shadow'
                        : 'bg-black/40 border-white/10 hover:border-white/30 text-white/90'
                    }`}
                  >
                    <span className="truncate">{th.name}</span>
                    {isSelected && <Check className="w-4 h-4 shrink-0 text-black" />}
                  </button>
                );
              })}
            </div>
          </CollapsibleSection>

          {/* Language Selection */}
          <CollapsibleSection
            icon={<Globe className="w-3.5 h-3.5" />}
            title={t.settingsLanguage}
            subtitle={currentLangLabel}
            open={!!openSections.language}
            onToggle={() => toggleSection('language')}
          >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  onClick={() => {
                    soundManager.playKeyTick();
                    onUpdateSettings({ language: l.code });
                  }}
                  className={`p-1.5 rounded text-center border cursor-pointer ${
                    settings.language === l.code
                      ? 'bg-amber-400 text-black font-bold border-amber-300'
                      : 'bg-black/40 border-white/10 hover:bg-white/10 text-white'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </CollapsibleSection>

          {/* Appearance & Effects */}
          <CollapsibleSection
            icon={<Monitor className="w-3.5 h-3.5" />}
            title={t.settingsAppearance}
            subtitle={settings.crtEffectEnabled ? t.settingsCrtActive : undefined}
            open={!!openSections.appearance}
            onToggle={() => toggleSection('appearance')}
          >
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.showToolbar}
                onChange={(e) => onUpdateSettings({ showToolbar: e.target.checked })}
              />
              <span>{t.settingsToolbar}</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.showCollapsibleInfoDrawer}
                onChange={(e) => onUpdateSettings({ showCollapsibleInfoDrawer: e.target.checked })}
              />
              <span>{t.settingsInfoBar}</span>
            </label>

            <div className="h-px bg-white/10 my-1"></div>

            <label className="flex items-center gap-2 cursor-pointer font-bold text-amber-300">
              <input
                type="checkbox"
                checked={settings.crtEffectEnabled}
                onChange={(e) => onUpdateSettings({ crtEffectEnabled: e.target.checked })}
              />
              <span>{t.settingsCrtEffect}</span>
            </label>

            {settings.crtEffectEnabled && (
              <div className="pl-6 flex items-center gap-3">
                <span className="text-[11px] font-bold">{t.settingsCrtIntensity}</span>
                <select
                  value={settings.crtIntensity || 'classic'}
                  onChange={(e) => onUpdateSettings({ crtIntensity: e.target.value as any })}
                  className="px-2 py-1 bg-black/70 border border-white/20 rounded text-xs text-amber-300 font-mono font-bold"
                >
                  <option value="subtle">{t.settingsCrtSubtle}</option>
                  <option value="classic">{t.settingsCrtClassic}</option>
                  <option value="intense">{t.settingsCrtIntense}</option>
                </select>
              </div>
            )}

            <label className="flex items-center gap-2 cursor-pointer font-bold text-emerald-300">
              <input
                type="checkbox"
                checked={settings.blinkingCursorEnabled}
                onChange={(e) => onUpdateSettings({ blinkingCursorEnabled: e.target.checked })}
              />
              <span>{t.settingsBlinkCursor}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="opacity-70">{t.settingsCursorBlinkColor}</span>
              <select
                value={settings.cursorBlinkColor || 'cyan'}
                onChange={(e) => onUpdateSettings({ cursorBlinkColor: e.target.value as any })}
                className="px-2 py-1 bg-black/70 border border-white/20 rounded text-xs text-amber-300 font-mono font-bold"
              >
                <option value="amber">{t.settingsColorAmber}</option>
                <option value="cyan">{t.settingsColorCyan}</option>
                <option value="green">{t.settingsColorGreen}</option>
                <option value="red">{t.settingsColorRed}</option>
                <option value="white">{t.settingsColorWhite}</option>
              </select>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="opacity-70">{t.settingsSelectorColor}</span>
              <select
                value={settings.fileSelectorColor || 'blue'}
                onChange={(e) => onUpdateSettings({ fileSelectorColor: e.target.value as any })}
                className="px-2 py-1 bg-black/70 border border-white/20 rounded text-xs text-amber-300 font-mono font-bold"
              >
                <option value="blue">{t.settingsColorBlue}</option>
                <option value="amber">{t.settingsColorAmber}</option>
                <option value="cyan">{t.settingsColorCyan}</option>
                <option value="green">{t.settingsColorGreen}</option>
                <option value="red">{t.settingsColorRed}</option>
                <option value="purple">{t.settingsColorPurple}</option>
              </select>
            </label>

            <div className="h-px bg-white/10 my-1"></div>

            <label className="flex items-center gap-2 cursor-pointer font-bold text-amber-300">
              <input
                type="checkbox"
                checked={settings.showClock}
                onChange={(e) => onUpdateSettings({ showClock: e.target.checked })}
              />
              <span>{t.settingsClock}</span>
            </label>

            {settings.showClock && (
              <div className="pl-6 flex items-center gap-3">
                <span className="text-[11px] font-bold">{t.settingsClockPos}</span>
                <select
                  value={settings.clockPosition || 'header'}
                  onChange={(e) => onUpdateSettings({ clockPosition: e.target.value as any })}
                  className="px-2 py-1 bg-black/70 border border-white/20 rounded text-xs text-amber-300 font-mono font-bold"
                >
                  <option value="header">{t.settingsClockHeader}</option>
                  <option value="footer">{t.settingsClockFooter}</option>
                  <option value="both">{t.settingsClockBoth}</option>
                </select>
              </div>
            )}
          </CollapsibleSection>

          {/* Behavior & Confirmations */}
          <CollapsibleSection
            icon={<Sliders className="w-3.5 h-3.5" />}
            title={t.settingsFilesSection}
            open={!!openSections.behavior}
            onToggle={() => toggleSection('behavior')}
          >
            <label className="flex items-center gap-2 cursor-pointer font-semibold text-emerald-300">
              <input
                type="checkbox"
                checked={settings.showHoverTooltips}
                onChange={(e) => onUpdateSettings({ showHoverTooltips: e.target.checked })}
              />
              <span>{t.settingsHoverTooltips}</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer font-semibold text-cyan-300 pl-4">
              <input
                type="checkbox"
                checked={settings.showImageHoverThumbnails}
                onChange={(e) => onUpdateSettings({ showImageHoverThumbnails: e.target.checked })}
                disabled={!settings.showHoverTooltips}
              />
              <span>{t.settingsThumbnails}</span>
            </label>

            <div className="h-px bg-white/10 my-1"></div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.confirmDelete}
                onChange={(e) => onUpdateSettings({ confirmDelete: e.target.checked })}
              />
              <span>{t.settingsConfirmDelete}</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.confirmCopyOverwrite}
                onChange={(e) => onUpdateSettings({ confirmCopyOverwrite: e.target.checked })}
              />
              <span>{t.settingsConfirmOverwrite}</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.showHiddenFiles}
                onChange={(e) => onUpdateSettings({ showHiddenFiles: e.target.checked })}
              />
              <span>{t.settingsShowHidden}</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.showSystemFiles}
                onChange={(e) => onUpdateSettings({ showSystemFiles: e.target.checked })}
              />
              <span>{t.settingsShowSystem}</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer font-bold text-rose-300">
              <input
                type="checkbox"
                checked={settings.useRecycleBin !== false}
                onChange={(e) => onUpdateSettings({ useRecycleBin: e.target.checked })}
              />
              <span>{t.settingsUseRecycleBin}</span>
            </label>
          </CollapsibleSection>

          {/* Keyboard Shortcuts */}
          <CollapsibleSection
            icon={<Keyboard className="w-3.5 h-3.5" />}
            title={t.settingsKeybindings}
            subtitle={settings.keybindingPreset || 'norton'}
            open={!!openSections.keybindings}
            onToggle={() => toggleSection('keybindings')}
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {keybindingPresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    soundManager.playKeyTick();
                    onUpdateSettings({ keybindingPreset: preset.id as any });
                  }}
                  className={`p-2 rounded border text-left cursor-pointer transition ${
                    (settings.keybindingPreset || 'norton') === preset.id
                      ? 'bg-amber-400 text-black font-bold border-amber-300 shadow'
                      : 'bg-black/50 border-white/10 text-white/80 hover:bg-white/5'
                  }`}
                >
                  <div className="font-bold text-xs">{preset.name}</div>
                  <div className="text-[9px] opacity-75 mt-0.5">{preset.desc}</div>
                </button>
              ))}
            </div>
          </CollapsibleSection>

          {/* Sound & Feedback */}
          <CollapsibleSection
            icon={<Volume2 className="w-3.5 h-3.5" />}
            title={t.settingsSoundSection}
            subtitle={settings.soundEffects ? t.settingsEnabled : t.settingsMuted}
            open={!!openSections.sound}
            onToggle={() => toggleSection('sound')}
          >
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.soundEffects}
                onChange={(e) => {
                  soundManager.setEnabled(e.target.checked);
                  if (e.target.checked) soundManager.playSuccess();
                  onUpdateSettings({ soundEffects: e.target.checked });
                }}
              />
              <span>{t.settingsSoundEnable}</span>
            </label>
          </CollapsibleSection>

          {/* Security */}
          <CollapsibleSection
            icon={<Lock className="w-3.5 h-3.5" />}
            title={t.settingsSecurity}
            subtitle={settings.appLockEnabled ? t.settingsAppLockActive : t.settingsDisabled}
            open={!!openSections.security}
            onToggle={() => toggleSection('security')}
          >
            <label className="flex items-center gap-2 cursor-pointer font-bold text-amber-400">
              <input
                type="checkbox"
                checked={settings.appLockEnabled}
                onChange={(e) => onUpdateSettings({ appLockEnabled: e.target.checked })}
              />
              <span>{t.settingsAppLock}</span>
            </label>

            {settings.appLockEnabled && (
              <div className="p-2.5 bg-black/60 rounded border border-amber-400/40 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] opacity-70 block font-bold">{t.settingsAppUser}</span>
                  <input
                    type="text"
                    value={settings.appUsername || 'admin'}
                    onChange={(e) => onUpdateSettings({ appUsername: e.target.value })}
                    className="w-full px-2 py-1 bg-black/70 border border-white/20 rounded text-xs text-white font-mono"
                  />
                </div>
                <div>
                  <span className="text-[10px] opacity-70 block font-bold">{t.settingsAppPass}</span>
                  <input
                    type="password"
                    value={newPassword} placeholder={settings.appPasswordSalt ? t.settingsAppPassSet : t.settingsAppPassNone} onBlur={async (e) => { const v = e.target.value.trim(); if (!v) return; try { const rec = await createPasswordRecord(v); onUpdateSettings({ appPasswordHash: rec.hash, appPasswordSalt: rec.salt }); setNewPassword(''); } catch { /* keep typed value to retry */ } }}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-2 py-1 bg-black/70 border border-white/20 rounded text-xs text-white font-mono"
                  />
                </div>
              </div>
            )}
          </CollapsibleSection>
        </div>

        {/* Backup & restore */}
        <div className="flex items-center gap-2 px-3 py-2 border-t text-xs shrink-0">
          <button
            onClick={() => {
              const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'omnicmd-settings.json';
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="px-2 py-1 border rounded cursor-pointer"
          >
            {t.settingsExportConfig}
          </button>
          <button
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = 'application/json';
              input.onchange = async (ev) => {
                const file = (ev.target as HTMLInputElement).files?.[0];
                if (!file) return;
                try {
                  const parsed = JSON.parse(await file.text());
                  onUpdateSettings(parsed);
                } catch {
                  alert(t.settingsInvalidConfig);
                }
              };
              input.click();
            }}
            className="px-2 py-1 border rounded cursor-pointer"
          >
            {t.settingsImportConfig}
          </button>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end px-3 py-2 border-t text-xs shrink-0"
          style={{
            backgroundColor: theme.modalBg,
            borderColor: theme.modalBorder
          }}
        >
          <button
            onClick={onClose}
            className="px-5 py-1.5 bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow"
          >
            {t.btnSave} / {t.btnClose}
          </button>
        </div>
    </ModalShell>
  );
};
