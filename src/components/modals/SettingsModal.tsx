import React, { useState, useCallback } from 'react';
import ModalShell from '../ModalShell';
import { Palette, Globe, Monitor, Sliders, Keyboard, Volume2, Lock, Save, Check, Eye, EyeOff } from 'lucide-react';
import { UserSettings, ThemeId, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations, TranslationKey } from '../../i18n/translations';
import { buildShortcutGroups } from '../../services/shortcutGroups';
import {
  TOOLBAR_ITEMS,
  DEFAULT_TOOLBAR_ITEMS,
  resolveToolbarItems,
  toggleToolbarItem,
  moveToolbarItem,
} from '../../services/toolbarItems';
import { soundManager } from '../../services/soundEffects';
import { checkPassword, createPasswordRecord } from '../../services/appLock';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useAppUpdate } from '../../hooks/useAppUpdate';

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

type SettingsTab = 'theme' | 'language' | 'appearance' | 'behavior' | 'keybindings' | 'sound' | 'security';

// Tab labels use translation keys for i18n support
const TAB_LABEL_KEYS: Record<SettingsTab, string> = {
  theme: 'settingsTabTheme',
  language: 'settingsTabLanguage',
  appearance: 'settingsTabAppearance',
  behavior: 'settingsTabBehavior',
  keybindings: 'settingsTabKeybindings',
  sound: 'settingsTabSound',
  security: 'settingsTabSecurity',
};

const TAB_ICONS: Record<SettingsTab, React.ReactNode> = {
  theme: <Palette className="w-4 h-4" />,
  language: <Globe className="w-4 h-4" />,
  appearance: <Monitor className="w-4 h-4" />,
  behavior: <Sliders className="w-4 h-4" />,
  keybindings: <Keyboard className="w-4 h-4" />,
  sound: <Volume2 className="w-4 h-4" />,
  security: <Lock className="w-4 h-4" />,
};

// Theme names are product names and stay as-is; only the colour hint in
// parentheses is localised.
const themeList: { id: ThemeId; name: string; colorsKey?: TranslationKey }[] = [
  { id: 'classic_blue', name: 'Omni Commander Classic', colorsKey: 'themeColorsBlueCyan' },
  { id: 'retro_gray', name: 'Omni Commander Retro', colorsKey: 'themeColorsGrayGreen' },
  { id: 'midnight_amber', name: 'Midnight Amber', colorsKey: 'themeColorsBlackAmber' },
  { id: 'matrix_green', name: 'Matrix Green', colorsKey: 'themeColorsBlackGreen' },
  { id: 'windows11_dark', name: 'Windows 11 Fluent Dark' },
  { id: 'windows11_light', name: 'Windows 11 Fluent Light' },
  { id: 'retro_futurist', name: 'Retro Futurista' },
  { id: 'dracula_retro', name: 'Dracula Retro Cyberpunk' },
  { id: 'solarized_dark', name: 'Solarized Dark Pro' },
];

type FormSettings = Partial<UserSettings> & {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

const INITIAL_FORM: FormSettings = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};

/**
 * Everything a settings file can carry about the app lock. Both directions drop
 * it: the three password fields are form-only and hold whatever was typed, in
 * clear; the salted hash would let anyone holding the file test guesses
 * offline; and `appLockEnabled` alone describes a lock nothing can open. Import
 * only merges the keys a file has, so a backup leaves the receiving machine's
 * own lock and credential untouched instead of arming or disarming it.
 */
const SETTINGS_LOCK_KEYS = [
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'appLockEnabled',
  'appPasswordHash',
  'appPasswordSalt',
] as const satisfies readonly (keyof FormSettings)[];

/** Payload for the settings export: the real settings, minus the lock keys. */
function buildSettingsExport(formData: FormSettings): Partial<UserSettings> {
  const exportable: Record<string, unknown> = { ...formData };
  for (const key of SETTINGS_LOCK_KEYS) delete exportable[key];
  return exportable as Partial<UserSettings>;
}

/**
 * Counterpart of `buildSettingsExport` for the import button. Payloads that are
 * not a settings object are rejected (the caller reports the invalid file)
 * rather than spread into the form as numeric keys, and the lock keys are
 * dropped so an old backup carrying `appLockEnabled: true` plus a hash — for a
 * password this machine may never have had — cannot arm a lock no credential
 * opens.
 */
function parseSettingsImport(raw: string): Partial<UserSettings> {
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('settings file is not a JSON object');
  }

  const importable: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
  for (const key of SETTINGS_LOCK_KEYS) delete importable[key];
  return importable as Partial<UserSettings>;
}

export function SettingsTabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-[var(--space-2)] px-[var(--space-2)] py-[var(--space-2)] rounded text-left text-[var(--fs-sm)] transition-all border ${
        active
          ? 'bg-amber-400 text-black font-bold border-amber-300 shadow'
          : 'bg-black/40 border-white/10 text-white/80 hover:bg-white/10 hover:border-white/30'
      }`}
    >
      <span className={`shrink-0 ${active ? 'text-black' : 'text-amber-300'}`}>{icon}</span>
      <span className={`truncate ${active ? 'font-bold' : 'font-medium'}`}>{label}</span>
    </button>
  );
}

export function SectionCard({
  title,
  children,
  className = '',
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded border border-white/10 bg-black/20 p-[var(--space-2)] space-y-[var(--space-2)] ${className}`}
    >
      <h4 className="font-bold text-amber-300 uppercase tracking-wider text-[var(--fs-sm)] mb-[var(--space-1)]">
        {title}
      </h4>
      <div className="space-y-[var(--space-1)]">{children}</div>
    </div>
  );
}

export function ThemePreview({ themeId, lang }: { themeId: ThemeId; lang: LanguageCode }) {
  const t = getTranslations(lang);
  const colors = useThemeColors(themeId);

  return (
    <div
      className="rounded border p-[var(--space-2)] mt-[var(--space-1)]"
      style={{ backgroundColor: colors.panel, borderColor: colors.accent }}
    >
      <div className="flex items-center gap-[var(--space-2)] mb-[var(--space-1)]">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: colors.accent }} />
        <span className="font-bold text-[var(--fs-sm)]" style={{ color: colors.text }}>
          {t.themePreviewLabel}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-[var(--space-1)] text-[var(--fs-8)]">
        <div className="p-[var(--space-1)] rounded" style={{ backgroundColor: colors.bg, color: colors.text }}>
          {t.themePreviewPanel}
        </div>
        <div className="p-[var(--space-1)] rounded" style={{ backgroundColor: colors.accent, color: '#000' }}>
          {t.themePreviewAccent}
        </div>
        <div className="p-[var(--space-1)] rounded" style={{ backgroundColor: colors.panel, color: colors.text }}>
          {t.themePreviewText}
        </div>
        <div className="p-[var(--space-1)] rounded" style={{ backgroundColor: colors.bg, color: colors.accent }}>
          {t.themePreviewBorder}
        </div>
      </div>
    </div>
  );
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ theme, lang, settings, onUpdateSettings, onClose }) => {
  const t = getTranslations(lang);
  const [activeTab, setActiveTab] = useState<SettingsTab>('theme');
  const [formData, setFormData] = useState<FormSettings>({ ...INITIAL_FORM, ...settings });
  const [errors, setErrors] = useState<Partial<Record<keyof FormSettings, string>>>({});
  // Password visibility is its own state. It used to ride on `touched`, which
  // every blur set to true, so leaving a password field revealed it in clear.
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const update = useAppUpdate();
  // The card reports the quiet outcomes the header chip hides, as the About box
  // does: a manual check that answers with nothing would look broken.
  const updateStatusText =
    update.status === 'available'
      ? t.updateAvailable.replace('{version}', update.version || '')
      : update.status === 'downloading'
        ? t.updateDownloading.replace('{percent}', String(update.percent))
        : update.status === 'up-to-date'
          ? t.updateUpToDate
          : update.status === 'error'
            ? t.updateFailed
            : '';

  // Validación en tiempo real
  const validateField = useCallback(
    <K extends keyof FormSettings>(name: K, value: unknown) => {
      const newErrors = { ...errors };
      if (name === 'newPassword' && value && value !== formData.confirmPassword) {
        newErrors.confirmPassword = t.protectMismatch;
      } else if (name === 'confirmPassword' && value && value !== formData.newPassword) {
        newErrors.confirmPassword = t.protectMismatch;
      } else if (name === 'confirmPassword' && value && value === formData.newPassword) {
        delete newErrors.confirmPassword;
      }
      setErrors(newErrors);
    },
    [errors, formData],
  );

  const handleChange = useCallback(
    <K extends keyof FormSettings>(name: K, value: unknown) => {
      // A `<select>` hands over a string, so the field's own type is the one
      // place where the narrowing belongs; the form is validated before saving.
      setFormData((prev) => ({ ...prev, [name]: value as FormSettings[K] }));
      validateField(name, value);
    },
    [validateField],
  );

  const handleSave = async () => {
    // Validar todo antes de guardar
    const newErrors: Partial<Record<keyof FormSettings, string>> = {};
    if (formData.newPassword && formData.newPassword !== formData.confirmPassword) {
      newErrors.confirmPassword = t.protectMismatch;
    }
    // Enabling the lock without any password would create a lock that no
    // credential can open, so the save is refused instead.
    if (formData.appLockEnabled && !formData.appPasswordHash && !formData.newPassword) {
      newErrors.newPassword = t.settingsAppLockNeedsPassword;
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setActiveTab('security');
      return;
    }

    // Replacing an existing password requires proving knowledge of the current
    // one: otherwise an unlocked-but-unattended session could take over the lock.
    if (formData.newPassword && formData.appPasswordHash) {
      if (!formData.currentPassword) {
        setErrors({ currentPassword: t.settingsAppCurrentPassRequired });
        setActiveTab('security');
        return;
      }
      try {
        const currentOk = await checkPassword(
          formData.currentPassword,
          formData.appPasswordHash,
          formData.appPasswordSalt || undefined,
        );
        if (!currentOk) {
          soundManager.playBeep(250, 0.2);
          setErrors({ currentPassword: t.settingsAppCurrentPassWrong });
          setFormData((prev) => ({ ...prev, currentPassword: '' }));
          setActiveTab('security');
          return;
        }
      } catch {
        setErrors({ currentPassword: t.appLockNoWebCrypto });
        setActiveTab('security');
        return;
      }
    }

    // The plaintext password never leaves this function: only the salted PBKDF2
    // hash is persisted. The password fields are form-only and are stripped below.
    const {
      newPassword,
      confirmPassword: _confirmPassword,
      currentPassword: _currentPassword,
      ...settingsToSave
    } = formData;
    if (newPassword) {
      try {
        const record = await createPasswordRecord(newPassword);
        settingsToSave.appPasswordHash = record.hash;
        settingsToSave.appPasswordSalt = record.salt;
        setFormData((prev) => ({
          ...prev,
          currentPassword: '',
          newPassword: '',
          confirmPassword: '',
          appPasswordHash: record.hash,
          appPasswordSalt: record.salt,
        }));
      } catch {
        setErrors((prev) => ({
          ...prev,
          newPassword: t.appLockNoWebCrypto,
        }));
        return;
      }
    }

    setErrors({});
    onUpdateSettings(settingsToSave);
    soundManager.playSuccess();
  };

  const handleCancel = () => {
    onClose();
  };

  const themeTabContent = (
    <div className="space-y-[var(--space-2)]">
      <SectionCard title={t.settingsTheme}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-1)]">
          {themeList.map((th) => {
            const isSelected = formData.theme === th.id;
            return (
              <button
                key={th.id}
                type="button"
                onClick={() => {
                  soundManager.playKeyTick();
                  setFormData((prev) => ({ ...prev, theme: th.id }));
                }}
                className={`p-[var(--space-2)] rounded text-left border flex items-center justify-between cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-amber-400 text-black border-amber-300 font-bold shadow'
                    : 'bg-black/40 border-white/10 hover:border-white/30 text-white/90'
                }`}
              >
                <span className="truncate">
                  {th.name}
                  {th.colorsKey ? ` ${t[th.colorsKey]}` : ''}
                </span>
                {isSelected && <Check className="w-4 h-4 shrink-0 text-black" />}
              </button>
            );
          })}
        </div>
        {/* The form only omits the theme when the saved settings do, and the
            preview then shows the one the app is running. */}
        <ThemePreview themeId={formData.theme ?? theme.id} lang={lang} />

        <div className="h-px bg-white/10 my-[var(--space-1)]"></div>

        <label className="flex items-center gap-[var(--space-2)] cursor-pointer">
          <span className="opacity-70">{t.settingsSelectorColor}</span>
          <select
            value={formData.fileSelectorColor || 'blue'}
            onChange={(e) => handleChange('fileSelectorColor', e.target.value)}
            className="px-[var(--space-2)] py-[var(--space-1)] bg-black/70 border border-white/20 rounded text-xs text-amber-300 font-mono font-bold"
          >
            <option value="blue">{t.settingsColorBlue}</option>
            <option value="amber">{t.settingsColorAmber}</option>
            <option value="cyan">{t.settingsColorCyan}</option>
            <option value="green">{t.settingsColorGreen}</option>
            <option value="red">{t.settingsColorRed}</option>
            <option value="purple">{t.settingsColorPurple}</option>
          </select>
        </label>

        {[
          { key: 'customFolderColor' as const, label: t.settingsFolderColor, value: theme.folderText ?? theme.accent },
          { key: 'customTextColor' as const, label: t.settingsTextColor, value: theme.itemText },
          { key: 'customSelectorColor' as const, label: t.settingsSelectorColorCustom, value: theme.cursorBg },
        ].map((picker) => (
          <label key={picker.key} className="flex items-center gap-[var(--space-2)] cursor-pointer">
            <span className="opacity-70">{picker.label}</span>
            <input
              type="color"
              value={formData[picker.key] || picker.value}
              onChange={(e) => handleChange(picker.key, e.target.value)}
              className="h-6 w-10 bg-transparent border border-white/20 rounded cursor-pointer"
            />
            <button
              type="button"
              onClick={() => handleChange(picker.key, '')}
              className="text-[10px] underline opacity-70 hover:opacity-100"
            >
              {t.settingsColorFromTheme}
            </button>
          </label>
        ))}
      </SectionCard>
    </div>
  );

  const languageTabContent = (
    <SectionCard title={t.settingsLanguage}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-[var(--space-1)]">
        {LANGUAGES.map((l) => (
          <button
            key={l.code}
            type="button"
            onClick={() => {
              soundManager.playKeyTick();
              setFormData((prev) => ({ ...prev, language: l.code }));
            }}
            className={`p-[var(--space-1)] rounded text-center border cursor-pointer ${
              formData.language === l.code
                ? 'bg-amber-400 text-black font-bold border-amber-300'
                : 'bg-black/40 border-white/10 hover:bg-white/10 text-white'
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
    </SectionCard>
  );

  const appearanceTabContent = (
    <div className="space-y-[var(--space-2)]">
      <SectionCard title={t.settingsAppearance}>
        <label className="flex items-center gap-[var(--space-2)] cursor-pointer">
          <input
            type="checkbox"
            checked={formData.showToolbar}
            onChange={(e) => handleChange('showToolbar', e.target.checked)}
          />
          <span>{t.settingsToolbar}</span>
        </label>

        <label className="flex items-center gap-[var(--space-2)] cursor-pointer">
          <input
            type="checkbox"
            checked={formData.menuBarHoverOpen ?? false}
            onChange={(e) => handleChange('menuBarHoverOpen', e.target.checked)}
          />
          <span>{t.settingsMenuHoverOpen}</span>
        </label>

        <label className="flex items-center gap-[var(--space-2)] cursor-pointer">
          <input
            type="checkbox"
            checked={formData.showCollapsibleInfoDrawer}
            onChange={(e) => handleChange('showCollapsibleInfoDrawer', e.target.checked)}
          />
          <span>{t.settingsInfoBar}</span>
        </label>

        <div className="h-px bg-white/10 my-[var(--space-1)]"></div>

        <label className="flex items-center gap-[var(--space-2)] cursor-pointer font-bold text-amber-300">
          <input
            type="checkbox"
            checked={formData.crtEffectEnabled}
            onChange={(e) => handleChange('crtEffectEnabled', e.target.checked)}
          />
          <span>{t.settingsCrtEffect}</span>
        </label>

        {formData.crtEffectEnabled && (
          <div className="pl-[var(--space-4)] flex items-center gap-[var(--space-2)]">
            <span className="text-[var(--fs-sm)] font-bold">{t.settingsCrtIntensity}</span>
            <select
              value={formData.crtIntensity || 'classic'}
              onChange={(e) => handleChange('crtIntensity', e.target.value)}
              className="px-[var(--space-2)] py-[var(--space-1)] bg-black/70 border border-white/20 rounded text-xs text-amber-300 font-mono font-bold"
            >
              <option value="subtle">{t.settingsCrtSubtle}</option>
              <option value="classic">{t.settingsCrtClassic}</option>
              <option value="intense">{t.settingsCrtIntense}</option>
            </select>
          </div>
        )}

        <label className="flex items-center gap-[var(--space-2)] cursor-pointer font-bold text-emerald-300">
          <input
            type="checkbox"
            checked={formData.blinkingCursorEnabled}
            onChange={(e) => handleChange('blinkingCursorEnabled', e.target.checked)}
          />
          <span>{t.settingsBlinkCursor}</span>
        </label>

        <label className="flex items-center gap-[var(--space-2)] cursor-pointer">
          <span className="opacity-70">{t.settingsCursorBlinkColor}</span>
          <select
            value={formData.cursorBlinkColor || 'cyan'}
            onChange={(e) => handleChange('cursorBlinkColor', e.target.value)}
            className="px-[var(--space-2)] py-[var(--space-1)] bg-black/70 border border-white/20 rounded text-xs text-amber-300 font-mono font-bold"
          >
            <option value="amber">{t.settingsColorAmber}</option>
            <option value="cyan">{t.settingsColorCyan}</option>
            <option value="green">{t.settingsColorGreen}</option>
            <option value="red">{t.settingsColorRed}</option>
            <option value="white">{t.settingsColorWhite}</option>
          </select>
        </label>

        <div className="h-px bg-white/10 my-[var(--space-1)]"></div>

        <label className="flex items-center gap-[var(--space-2)] cursor-pointer font-bold text-amber-300">
          <input
            type="checkbox"
            checked={formData.showClock}
            onChange={(e) => handleChange('showClock', e.target.checked)}
          />
          <span>{t.settingsClock}</span>
        </label>

        {formData.showClock && (
          <div className="pl-[var(--space-4)] flex items-center gap-[var(--space-2)]">
            <span className="text-[var(--fs-sm)] font-bold">{t.settingsClockPos}</span>
            <select
              value={formData.clockPosition || 'header'}
              onChange={(e) => handleChange('clockPosition', e.target.value)}
              className="px-[var(--space-2)] py-[var(--space-1)] bg-black/70 border border-white/20 rounded text-xs text-amber-300 font-mono font-bold"
            >
              <option value="header">{t.settingsClockHeader}</option>
              <option value="footer">{t.settingsClockFooter}</option>
              <option value="both">{t.settingsClockBoth}</option>
            </select>
          </div>
        )}
      </SectionCard>

      <SectionCard title={t.settingsToolbarSection}>
        <p className="text-[var(--fs-sm)] opacity-70">{t.settingsToolbarHint}</p>
        <div className="space-y-[var(--space-1)]">
          {resolveToolbarItems(formData.toolbarItems).map((id, index, list) => {
            const definition = TOOLBAR_ITEMS.find((entry) => entry.id === id);
            if (!definition) return null;
            return (
              <div key={id} className="flex items-center gap-[var(--space-2)]">
                <input
                  type="checkbox"
                  checked
                  onChange={() =>
                    setFormData((prev) => ({ ...prev, toolbarItems: toggleToolbarItem(prev.toolbarItems, id) }))
                  }
                />
                <span className="flex-1 truncate">{t[definition.labelKey]}</span>
                <button
                  type="button"
                  disabled={index === 0}
                  title={t.toolbarItemMoveUp}
                  aria-label={t.toolbarItemMoveUp}
                  onClick={() =>
                    setFormData((prev) => ({ ...prev, toolbarItems: moveToolbarItem(prev.toolbarItems, id, -1) }))
                  }
                  className="px-[var(--space-1)] rounded border border-white/20 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={index === list.length - 1}
                  title={t.toolbarItemMoveDown}
                  aria-label={t.toolbarItemMoveDown}
                  onClick={() =>
                    setFormData((prev) => ({ ...prev, toolbarItems: moveToolbarItem(prev.toolbarItems, id, 1) }))
                  }
                  className="px-[var(--space-1)] rounded border border-white/20 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  ↓
                </button>
              </div>
            );
          })}
        </div>
        <div className="h-px bg-white/10 my-[var(--space-1)]"></div>
        {/* Hidden commands stay listed, so turning one back on is a click and
            not a guess about which buttons this build even has. */}
        <div className="space-y-[var(--space-1)]">
          {DEFAULT_TOOLBAR_ITEMS.filter((id) => !resolveToolbarItems(formData.toolbarItems).includes(id)).map((id) => {
            const definition = TOOLBAR_ITEMS.find((entry) => entry.id === id);
            if (!definition) return null;
            return (
              <label key={id} className="flex items-center gap-[var(--space-2)] cursor-pointer opacity-70">
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() =>
                    setFormData((prev) => ({ ...prev, toolbarItems: toggleToolbarItem(prev.toolbarItems, id) }))
                  }
                />
                <span className="truncate">{t[definition.labelKey]}</span>
              </label>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );

  const behaviorTabContent = (
    <div className="space-y-[var(--space-2)]">
      <SectionCard title={t.settingsFilesSection}>
        <label className="flex items-center gap-[var(--space-2)] cursor-pointer font-semibold text-emerald-300">
          <input
            type="checkbox"
            checked={formData.showHoverTooltips}
            onChange={(e) => handleChange('showHoverTooltips', e.target.checked)}
          />
          <span>{t.settingsHoverTooltips}</span>
        </label>

        <label className="flex items-center gap-[var(--space-2)] cursor-pointer font-semibold text-cyan-300 pl-[var(--space-4)]">
          <input
            type="checkbox"
            checked={formData.showImageHoverThumbnails}
            onChange={(e) => handleChange('showImageHoverThumbnails', e.target.checked)}
            disabled={!formData.showHoverTooltips}
          />
          <span>{t.settingsThumbnails}</span>
        </label>

        <div className="h-px bg-white/10 my-[var(--space-1)]"></div>

        <label className="flex items-center gap-[var(--space-2)] cursor-pointer">
          <input
            type="checkbox"
            checked={formData.confirmDelete}
            onChange={(e) => handleChange('confirmDelete', e.target.checked)}
          />
          <span>{t.settingsConfirmDelete}</span>
        </label>

        <label className="flex items-center gap-[var(--space-2)] cursor-pointer">
          <input
            type="checkbox"
            checked={formData.confirmCopyOverwrite}
            onChange={(e) => handleChange('confirmCopyOverwrite', e.target.checked)}
          />
          <span>{t.settingsConfirmOverwrite}</span>
        </label>

        <label className="flex items-center gap-[var(--space-2)] cursor-pointer">
          <input
            type="checkbox"
            checked={formData.showHiddenFiles}
            onChange={(e) => handleChange('showHiddenFiles', e.target.checked)}
          />
          <span>{t.settingsShowHidden}</span>
        </label>

        <label className="flex items-center gap-[var(--space-2)] cursor-pointer">
          <input
            type="checkbox"
            checked={formData.showSystemFiles}
            onChange={(e) => handleChange('showSystemFiles', e.target.checked)}
          />
          <span>{t.settingsShowSystem}</span>
        </label>

        <label className="flex items-center gap-[var(--space-2)] cursor-pointer font-bold nc-danger-ink">
          <input
            type="checkbox"
            checked={formData.useRecycleBin !== false}
            onChange={(e) => handleChange('useRecycleBin', e.target.checked)}
          />
          <span>{t.settingsUseRecycleBin}</span>
        </label>
      </SectionCard>
    </div>
  );

  // The keys this program answers to, not a menu of other file managers' schemes:
  // there is nothing to choose, only the list to read. The same groups the manual
  // shows, so the two can never disagree.
  const keybindingsTabContent = (
    <div className="space-y-[var(--space-2)]">
      <h3 className="px-[var(--space-1)] text-[var(--fs-8)] font-bold uppercase tracking-wider text-amber-300">
        {t.settingsKeybindings}
      </h3>
      {buildShortcutGroups(t).map((group) => (
        <SectionCard key={group.title} title={group.title}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-1)]">
            {group.shortcuts.map((shortcut) => (
              <div key={shortcut.key} className="flex items-center gap-[var(--space-2)] py-[2px]">
                <kbd className="shrink-0 min-w-[5.5rem] rounded border border-amber-400/40 bg-black/60 px-[var(--space-1)] py-[2px] text-center font-bold text-amber-300 text-[var(--fs-8)]">
                  {shortcut.key}
                </kbd>
                <span className="text-[var(--fs-sm)] opacity-90">{shortcut.desc}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      ))}
    </div>
  );

  const soundTabContent = (
    <SectionCard title={t.settingsSoundSection}>
      <label className="flex items-center gap-[var(--space-2)] cursor-pointer">
        <input
          type="checkbox"
          checked={formData.soundEffects}
          onChange={(e) => {
            soundManager.setEnabled(e.target.checked);
            if (e.target.checked) soundManager.playSuccess();
            handleChange('soundEffects', e.target.checked);
          }}
        />
        <span>{t.settingsSoundEnable}</span>
      </label>
    </SectionCard>
  );

  // A stored hash or a password typed in this session are both enough to enable
  // the lock; otherwise there would be nothing to unlock with.
  const passwordReady = !!formData.appPasswordHash || formData.newPassword.length > 0;

  const securityTabContent = (
    <div className="space-y-[var(--space-2)]">
      <SectionCard title={t.settingsSecurity}>
        <label className="flex items-center gap-[var(--space-2)] cursor-pointer font-bold text-amber-400">
          <input
            type="checkbox"
            checked={formData.appLockEnabled}
            disabled={!passwordReady && !formData.appLockEnabled}
            onChange={(e) => {
              if (e.target.checked && !passwordReady) {
                soundManager.playBeep(220, 0.2);
                window.alert(t.settingsAppLockNeedsPassword);
                return;
              }
              handleChange('appLockEnabled', e.target.checked);
            }}
          />
          <span>{t.settingsAppLock}</span>
        </label>

        {/* Always visible so the first password can be created: the lock itself
            cannot be enabled until one exists. */}
        <div className="p-[var(--space-2)] bg-black/60 rounded border border-amber-400/40 grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-2)]">
          {/* A stored password can only be replaced by someone who knows it. */}
          {formData.appPasswordHash && (
            <div className="sm:col-span-2">
              <span className="text-[var(--fs-8)] opacity-70 block font-bold mb-0.5">{t.settingsAppCurrentPass}</span>
              <div className="relative">
                <input
                  aria-label={t.settingsAppCurrentPass}
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={formData.currentPassword}
                  onChange={(e) => handleChange('currentPassword', e.target.value)}
                  className="w-full px-[var(--space-2)] py-[var(--space-1)] bg-black/70 border border-white/20 rounded text-xs text-white font-mono pr-[var(--space-7)]"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword((v) => !v)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-amber-300 hover:text-amber-100"
                  aria-label={showCurrentPassword ? t.settingsHidePassword : t.settingsShowPassword}
                  aria-pressed={showCurrentPassword}
                >
                  {showCurrentPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
                {errors.currentPassword && (
                  <span className="text-[var(--fs-8)] nc-danger-ink mt-[var(--space-1)] block">
                    {errors.currentPassword}
                  </span>
                )}
              </div>
            </div>
          )}
          <div>
            <span className="text-[var(--fs-8)] opacity-70 block font-bold mb-0.5">{t.settingsAppUser}</span>
            <input
              type="text"
              value={formData.appUsername || 'admin'}
              onChange={(e) => handleChange('appUsername', e.target.value)}
              className="w-full px-[var(--space-2)] py-[var(--space-1)] bg-black/70 border border-white/20 rounded text-xs text-white font-mono"
            />
          </div>
          <div>
            <span className="text-[var(--fs-8)] opacity-70 block font-bold mb-0.5">{t.settingsAppPass}</span>
            <div className="relative">
              <input
                aria-label={t.settingsAppPass}
                type={showNewPassword ? 'text' : 'password'}
                value={formData.newPassword}
                placeholder={formData.appPasswordSalt ? t.settingsAppPassSet : t.settingsAppPassNone}
                onChange={(e) => handleChange('newPassword', e.target.value)}
                className="w-full px-[var(--space-2)] py-[var(--space-1)] bg-black/70 border border-white/20 rounded text-xs text-white font-mono pr-[var(--space-7)]"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword((v) => !v)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-amber-300 hover:text-amber-100"
                aria-label={showNewPassword ? t.settingsHidePassword : t.settingsShowPassword}
                aria-pressed={showNewPassword}
              >
                {showNewPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
              {errors.newPassword && (
                <span className="text-[var(--fs-8)] nc-danger-ink mt-[var(--space-1)] block">{errors.newPassword}</span>
              )}
            </div>
          </div>
          <div className="sm:col-span-2">
            <span className="text-[var(--fs-8)] opacity-70 block font-bold mb-0.5">{t.protectConfirm}</span>
            <div className="relative">
              <input
                aria-label={t.protectConfirm}
                type={showConfirmPassword ? 'text' : 'password'}
                value={formData.confirmPassword}
                placeholder={t.protectConfirmPlaceholder}
                onChange={(e) => handleChange('confirmPassword', e.target.value)}
                className="w-full px-[var(--space-2)] py-[var(--space-1)] bg-black/70 border border-white/20 rounded text-xs text-white font-mono pr-[var(--space-7)]"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((v) => !v)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-amber-300 hover:text-amber-100"
                aria-label={showConfirmPassword ? t.settingsHidePassword : t.settingsShowPassword}
                aria-pressed={showConfirmPassword}
              >
                {showConfirmPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
              {errors.confirmPassword && (
                <span className="text-[var(--fs-8)] nc-danger-ink mt-[var(--space-1)] block">
                  {errors.confirmPassword}
                </span>
              )}
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Test versions are published as prereleases, which the stable feed never
          reads. Opting in is what makes them candidates: without the box, a beta
          is invisible however recently it was published. Outside Electron there
          is nothing to update, so the card is absent. */}
      {update.enabled && (
        <SectionCard title={t.settingsUpdatesSection}>
          <div className="flex flex-col gap-[var(--space-1)]">
            <label className="flex items-center gap-[var(--space-2)] cursor-pointer">
              <input
                type="checkbox"
                checked={update.channel === 'beta'}
                onChange={(e) => {
                  void update.setChannel(e.target.checked ? 'beta' : 'stable');
                }}
              />
              <span>{t.updateChannelBeta}</span>
            </label>
            <span className="text-[var(--fs-8)] opacity-70 leading-relaxed">{t.updateChannelBetaHint}</span>
            {update.channel === 'beta' && (
              <span className="text-[var(--fs-8)] text-sky-300">{t.updateChannelBetaActive}</span>
            )}
            {/* The check the main process also runs on its own, on demand: the
                card is where the feed is chosen, so it is where asking belongs. */}
            <div className="flex flex-wrap items-center gap-[var(--space-2)] pt-[var(--space-1)]">
              <button
                onClick={update.check}
                disabled={update.status === 'checking' || update.status === 'downloading'}
                className="px-[var(--space-2)] py-[var(--space-1)] text-[10px] font-bold rounded border border-sky-400/40 bg-sky-500/20 hover:bg-sky-500/30 text-sky-200 cursor-pointer disabled:opacity-50 disabled:cursor-default"
              >
                {update.status === 'checking' ? t.updateChecking : t.updateCheck}
              </button>
              {updateStatusText && <span className="text-[var(--fs-8)] text-sky-300">{updateStatusText}</span>}
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  );

  const tabContent = {
    theme: themeTabContent,
    language: languageTabContent,
    appearance: appearanceTabContent,
    behavior: behaviorTabContent,
    keybindings: keybindingsTabContent,
    sound: soundTabContent,
    security: securityTabContent,
  };

  return (
    <ModalShell title={t.settingsTitle} theme={theme} onClose={handleCancel} closeButtonLabel={t.btnCancel}>
      <div
        className="w-full max-w-3xl max-h-[90vh] flex flex-row rounded shadow-2xl border text-[var(--fs-sm)] overflow-hidden"
        style={{ backgroundColor: theme.modalBg, borderColor: theme.modalBorder, color: theme.itemText }}
      >
        {/* Sidebar - Vertical Tabs */}
        <div className="flex flex-col gap-[var(--space-1)] bg-black/30 p-[var(--space-1)] border-r border-white/10 shrink-0 min-w-[140px]">
          {(Object.keys(TAB_ICONS) as SettingsTab[]).map((tabId) => (
            <SettingsTabButton
              key={tabId}
              active={activeTab === tabId}
              onClick={() => setActiveTab(tabId)}
              icon={TAB_ICONS[tabId]}
              label={t[TAB_LABEL_KEYS[tabId] as TranslationKey] || tabId}
            />
          ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Content */}
          <div className="flex-1 overflow-y-auto p-[var(--space-2)] space-y-[var(--space-2)]">
            {tabContent[activeTab]}
          </div>

          {/* Footer Actions */}
          <div
            className="flex items-center justify-between px-[var(--space-2)] py-[var(--space-2)] border-t text-[var(--fs-sm)] shrink-0"
            style={{ backgroundColor: theme.modalBg, borderColor: theme.modalBorder }}
          >
            <div className="flex items-center gap-[var(--space-1)]">
              <button
                onClick={() => {
                  const payload = buildSettingsExport(formData);
                  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'omnicmd-settings.json';
                  a.click();
                  URL.revokeObjectURL(url);
                  soundManager.playKeyTick();
                }}
                className="px-[var(--space-2)] py-[var(--space-1)] border rounded cursor-pointer text-[var(--fs-8)]"
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
                      const parsed = parseSettingsImport(await file.text());
                      setFormData((prev) => ({ ...prev, ...parsed }));
                      soundManager.playSuccess();
                    } catch {
                      alert(t.settingsInvalidConfig);
                    }
                  };
                  input.click();
                }}
                className="px-[var(--space-2)] py-[var(--space-1)] border rounded cursor-pointer text-[var(--fs-8)]"
              >
                {t.settingsImportConfig}
              </button>
            </div>
            <div className="flex items-center gap-[var(--space-2)]">
              <button
                onClick={handleCancel}
                className="px-[var(--space-3)] py-[var(--space-1)] bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer flex items-center gap-[var(--space-1)]"
              >
                {t.btnCancel}
              </button>
              <button
                onClick={() => {
                  void handleSave();
                }}
                className="px-[var(--space-3)] py-[var(--space-1)] bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow flex items-center gap-[var(--space-1)]"
              >
                <Save className="w-3 h-3" /> {t.btnSave}
              </button>
            </div>
          </div>
        </div>
      </div>
    </ModalShell>
  );
};
