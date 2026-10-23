import React, { useState, useMemo, useCallback } from 'react';
import ModalShell from '../ModalShell';
import {
  Settings,
  Palette,
  Globe,
  Monitor,
  Sliders,
  Keyboard,
  Volume2,
  Lock,
  Save,
  X,
  Check,
  Eye,
  EyeOff,
} from 'lucide-react';
import { UserSettings, ThemeId, LanguageCode } from '../../types';
import { ThemeConfig } from '../../services/themeManager';
import { getTranslations } from '../../i18n/translations';
import { soundManager } from '../../services/soundEffects';
import { createPasswordRecord } from '../../services/appLock';
import { useThemeColors } from '../../hooks/useThemeColors';

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

type SettingsTab =
  | 'theme'
  | 'language'
  | 'appearance'
  | 'behavior'
  | 'keybindings'
  | 'sound'
  | 'security';

const TAB_CONFIG: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'theme', label: 'Tema', icon: <Palette className="w-4 h-4" /> },
  { id: 'language', label: 'Idioma', icon: <Globe className="w-4 h-4" /> },
  { id: 'appearance', label: 'Apariencia', icon: <Monitor className="w-4 h-4" /> },
  { id: 'behavior', label: 'Archivos', icon: <Sliders className="w-4 h-4" /> },
  { id: 'keybindings', label: 'Atajos', icon: <Keyboard className="w-4 h-4" /> },
  { id: 'sound', label: 'Sonido', icon: <Volume2 className="w-4 h-4" /> },
  { id: 'security', label: 'Seguridad', icon: <Lock className="w-4 h-4" /> },
];

const themeList: { id: ThemeId; name: string }[] = [
  { id: 'classic_blue', name: 'Norton Classic (Azul/Cian)' },
  { id: 'retro_gray', name: 'Total Commander (Gris/Verde)' },
  { id: 'midnight_amber', name: 'Midnight Amber (Negro/Ámbar)' },
  { id: 'matrix_green', name: 'Matrix Green (Negro/Verde)' },
  { id: 'windows11_dark', name: 'Windows 11 Fluent Dark' },
  { id: 'windows11_light', name: 'Windows 11 Fluent Light' },
  { id: 'dracula_retro', name: 'Dracula Retro Cyberpunk' },
  { id: 'solarized_dark', name: 'Solarized Dark Pro' },
];

const keybindingPresets = [
  { id: 'norton', name: 'Norton Commander', desc: 'F3=Ver, F4=Editar, F5=Copiar, F6=Mover, F7=MkDir, F8=Borrar' },
  { id: 'totalcmd', name: 'Total Commander', desc: 'F3=Ver, F4=Editar, F5=Copiar, F6=Mover, F7=MkDir, F8=Borrar' },
  { id: 'midnight', name: 'Midnight Commander', desc: 'F3=Ver, F4=Editar, F5=Copiar, F6=Ren/Mov, F7=MkDir, F8=Borrar' },
];

type FormSettings = Partial<UserSettings> & {
  newPassword: string;
  confirmPassword: string;
};

const INITIAL_FORM: FormSettings = {
  newPassword: '',
  confirmPassword: '',
};

function SettingsTabButton({ active, onClick, icon, label }: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-[var(--fs-sm)] transition-all border ${
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

function SectionCard({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded border border-white/10 bg-black/20 p-1.5 space-y-1.5 ${className}`}>
      <h4 className="font-bold text-amber-300 uppercase tracking-wider text-[var(--fs-sm)] mb-1">{title}</h4>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function ThemePreview({ themeId }: { themeId: ThemeId }) {
  const colors = useThemeColors(themeId);

  return (
    <div className="rounded border p-1.5 mt-1" style={{ backgroundColor: colors.panel, borderColor: colors.accent }}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <div className="w-4 h-4 rounded" style={{ backgroundColor: colors.accent }} />
        <span className="font-bold text-[var(--fs-sm)]" style={{ color: colors.text }}>Vista previa</span>
      </div>
      <div className="grid grid-cols-2 gap-0.5 text-[var(--fs-8)]">
        <div className="p-0.5 rounded" style={{ backgroundColor: colors.bg, color: colors.text }}>Panel</div>
        <div className="p-0.5 rounded" style={{ backgroundColor: colors.accent, color: '#000' }}>Acento</div>
        <div className="p-0.5 rounded" style={{ backgroundColor: colors.panel, color: colors.text }}>Texto</div>
        <div className="p-0.5 rounded" style={{ backgroundColor: colors.bg, color: colors.accent }}>Borde</div>
      </div>
    </div>
  );
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  theme,
  lang,
  settings,
  onUpdateSettings,
  onClose,
}) => {
  const t = getTranslations(lang);
  const [activeTab, setActiveTab] = useState<SettingsTab>('theme');
  const [formData, setFormData] = useState<FormSettings>({ ...INITIAL_FORM, ...settings });
  const [errors, setErrors] = useState<Partial<Record<keyof FormSettings, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<keyof FormSettings, boolean>>>({});

  // Validación en tiempo real
  const validateField = useCallback((name: keyof FormSettings, value: any) => {
    const newErrors = { ...errors };
    if (name === 'newPassword' && value && value !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Las contraseñas no coinciden';
    } else if (name === 'confirmPassword' && value && value !== formData.newPassword) {
      newErrors.confirmPassword = 'Las contraseñas no coinciden';
    } else if (name === 'confirmPassword' && value && value === formData.newPassword) {
      delete newErrors.confirmPassword;
    }
    setErrors(newErrors);
  }, [errors, formData]);

  const handleChange = useCallback((name: keyof FormSettings, value: any) => {
    setFormData(prev => ({ ...prev, [name]: value }));
    validateField(name, value);
  }, [validateField]);

  const handleBlur = useCallback((name: keyof FormSettings) => {
    setTouched(prev => ({ ...prev, [name]: true }));
  }, []);

  const handleSave = () => {
    // Validar todo antes de guardar
    const newErrors: Partial<Record<keyof FormSettings, string>> = {};
    if (formData.newPassword && formData.newPassword !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Las contraseñas no coinciden';
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setTouched({ newPassword: true, confirmPassword: true });
      return;
    }
    // Guardar configuración
    const { newPassword, confirmPassword, ...settingsToSave } = formData;
    onUpdateSettings(settingsToSave);
    soundManager.playSuccess();
  };

  const handleCancel = () => {
    onClose();
  };

  const currentThemeName = themeList.find((th) => th.id === settings.theme)?.name;
  const currentLangLabel = LANGUAGES.find((l) => l.code === settings.language)?.label;

  const themeTabContent = (
    <div className="space-y-1.5">
      <SectionCard title={t.settingsTheme}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
          {themeList.map((th) => {
            const isSelected = formData.theme === th.id;
            return (
              <button
                key={th.id}
                type="button"
                onClick={() => {
                  soundManager.playKeyTick();
                  setFormData(prev => ({ ...prev, theme: th.id }));
                }}
                className={`p-1.5 rounded text-left border flex items-center justify-between cursor-pointer transition-all ${
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
        <ThemePreview themeId={formData.theme} />
      </SectionCard>
    </div>
  );

  const languageTabContent = (
    <SectionCard title={t.settingsLanguage}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
        {LANGUAGES.map((l) => (
          <button
            key={l.code}
            type="button"
            onClick={() => {
              soundManager.playKeyTick();
              setFormData(prev => ({ ...prev, language: l.code }));
            }}
            className={`p-1 rounded text-center border cursor-pointer ${
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
    <div className="space-y-1.5">
      <SectionCard title={t.settingsAppearance}>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.showToolbar}
            onChange={(e) => handleChange('showToolbar', e.target.checked)}
            onBlur={() => handleBlur('showToolbar')}
          />
          <span>{t.settingsToolbar}</span>
        </label>

        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.showCollapsibleInfoDrawer}
            onChange={(e) => handleChange('showCollapsibleInfoDrawer', e.target.checked)}
            onBlur={() => handleBlur('showCollapsibleInfoDrawer')}
          />
          <span>{t.settingsInfoBar}</span>
        </label>

        <div className="h-px bg-white/10 my-0.5"></div>

        <label className="flex items-center gap-1.5 cursor-pointer font-bold text-amber-300">
          <input
            type="checkbox"
            checked={formData.crtEffectEnabled}
            onChange={(e) => handleChange('crtEffectEnabled', e.target.checked)}
            onBlur={() => handleBlur('crtEffectEnabled')}
          />
          <span>{t.settingsCrtEffect}</span>
        </label>

        {formData.crtEffectEnabled && (
          <div className="pl-4 flex items-center gap-2">
            <span className="text-[var(--fs-sm)] font-bold">{t.settingsCrtIntensity}</span>
            <select
              value={formData.crtIntensity || 'classic'}
              onChange={(e) => handleChange('crtIntensity', e.target.value)}
              onBlur={() => handleBlur('crtIntensity')}
              className="px-1.5 py-0.5 bg-black/70 border border-white/20 rounded text-xs text-amber-300 font-mono font-bold"
            >
              <option value="subtle">{t.settingsCrtSubtle}</option>
              <option value="classic">{t.settingsCrtClassic}</option>
              <option value="intense">{t.settingsCrtIntense}</option>
            </select>
          </div>
        )}

        <label className="flex items-center gap-1.5 cursor-pointer font-bold text-emerald-300">
          <input
            type="checkbox"
            checked={formData.blinkingCursorEnabled}
            onChange={(e) => handleChange('blinkingCursorEnabled', e.target.checked)}
            onBlur={() => handleBlur('blinkingCursorEnabled')}
          />
          <span>{t.settingsBlinkCursor}</span>
        </label>

        <label className="flex items-center gap-1.5 cursor-pointer">
          <span className="opacity-70">{t.settingsCursorBlinkColor}</span>
          <select
            value={formData.cursorBlinkColor || 'cyan'}
            onChange={(e) => handleChange('cursorBlinkColor', e.target.value)}
            onBlur={() => handleBlur('cursorBlinkColor')}
            className="px-1.5 py-0.5 bg-black/70 border border-white/20 rounded text-xs text-amber-300 font-mono font-bold"
          >
            <option value="amber">{t.settingsColorAmber}</option>
            <option value="cyan">{t.settingsColorCyan}</option>
            <option value="green">{t.settingsColorGreen}</option>
            <option value="red">{t.settingsColorRed}</option>
            <option value="white">{t.settingsColorWhite}</option>
          </select>
        </label>

        <label className="flex items-center gap-1.5 cursor-pointer">
          <span className="opacity-70">{t.settingsSelectorColor}</span>
          <select
            value={formData.fileSelectorColor || 'blue'}
            onChange={(e) => handleChange('fileSelectorColor', e.target.value)}
            onBlur={() => handleBlur('fileSelectorColor')}
            className="px-1.5 py-0.5 bg-black/70 border border-white/20 rounded text-xs text-amber-300 font-mono font-bold"
          >
            <option value="blue">{t.settingsColorBlue}</option>
            <option value="amber">{t.settingsColorAmber}</option>
            <option value="cyan">{t.settingsColorCyan}</option>
            <option value="green">{t.settingsColorGreen}</option>
            <option value="red">{t.settingsColorRed}</option>
            <option value="purple">{t.settingsColorPurple}</option>
          </select>
        </label>

        <div className="h-px bg-white/10 my-0.5"></div>

        <label className="flex items-center gap-1.5 cursor-pointer font-bold text-amber-300">
          <input
            type="checkbox"
            checked={formData.showClock}
            onChange={(e) => handleChange('showClock', e.target.checked)}
            onBlur={() => handleBlur('showClock')}
          />
          <span>{t.settingsClock}</span>
        </label>

        {formData.showClock && (
          <div className="pl-4 flex items-center gap-2">
            <span className="text-[var(--fs-sm)] font-bold">{t.settingsClockPos}</span>
            <select
              value={formData.clockPosition || 'header'}
              onChange={(e) => handleChange('clockPosition', e.target.value)}
              onBlur={() => handleBlur('clockPosition')}
              className="px-1.5 py-0.5 bg-black/70 border border-white/20 rounded text-xs text-amber-300 font-mono font-bold"
            >
              <option value="header">{t.settingsClockHeader}</option>
              <option value="footer">{t.settingsClockFooter}</option>
              <option value="both">{t.settingsClockBoth}</option>
            </select>
          </div>
        )}
      </SectionCard>
    </div>
  );

  const behaviorTabContent = (
    <div className="space-y-1.5">
      <SectionCard title={t.settingsFilesSection}>
        <label className="flex items-center gap-1.5 cursor-pointer font-semibold text-emerald-300">
          <input
            type="checkbox"
            checked={formData.showHoverTooltips}
            onChange={(e) => handleChange('showHoverTooltips', e.target.checked)}
            onBlur={() => handleBlur('showHoverTooltips')}
          />
          <span>{t.settingsHoverTooltips}</span>
        </label>

        <label className="flex items-center gap-1.5 cursor-pointer font-semibold text-cyan-300 pl-4">
          <input
            type="checkbox"
            checked={formData.showImageHoverThumbnails}
            onChange={(e) => handleChange('showImageHoverThumbnails', e.target.checked)}
            onBlur={() => handleBlur('showImageHoverThumbnails')}
            disabled={!formData.showHoverTooltips}
          />
          <span>{t.settingsThumbnails}</span>
        </label>

        <div className="h-px bg-white/10 my-0.5"></div>

        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.confirmDelete}
            onChange={(e) => handleChange('confirmDelete', e.target.checked)}
            onBlur={() => handleBlur('confirmDelete')}
          />
          <span>{t.settingsConfirmDelete}</span>
        </label>

        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.confirmCopyOverwrite}
            onChange={(e) => handleChange('confirmCopyOverwrite', e.target.checked)}
            onBlur={() => handleBlur('confirmCopyOverwrite')}
          />
          <span>{t.settingsConfirmOverwrite}</span>
        </label>

        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.showHiddenFiles}
            onChange={(e) => handleChange('showHiddenFiles', e.target.checked)}
            onBlur={() => handleBlur('showHiddenFiles')}
          />
          <span>{t.settingsShowHidden}</span>
        </label>

        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.showSystemFiles}
            onChange={(e) => handleChange('showSystemFiles', e.target.checked)}
            onBlur={() => handleBlur('showSystemFiles')}
          />
          <span>{t.settingsShowSystem}</span>
        </label>

        <label className="flex items-center gap-1.5 cursor-pointer font-bold text-rose-300">
          <input
            type="checkbox"
            checked={formData.useRecycleBin !== false}
            onChange={(e) => handleChange('useRecycleBin', e.target.checked)}
            onBlur={() => handleBlur('useRecycleBin')}
          />
          <span>{t.settingsUseRecycleBin}</span>
        </label>
      </SectionCard>
    </div>
  );

  const keybindingsTabContent = (
    <SectionCard title={t.settingsKeybindings}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1">
        {keybindingPresets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => {
              soundManager.playKeyTick();
              setFormData(prev => ({ ...prev, keybindingPreset: preset.id as any }));
            }}
            className={`p-1.5 rounded border text-left cursor-pointer transition ${
              formData.keybindingPreset === preset.id
                ? 'bg-amber-400 text-black font-bold border-amber-300 shadow'
                : 'bg-black/50 border-white/10 text-white/80 hover:bg-white/5'
            }`}
          >
            <div className="font-bold text-[var(--fs-sm)]">{preset.name}</div>
            <div className="text-[var(--fs-8)] opacity-75 mt-0.5">{preset.desc}</div>
          </button>
        ))}
      </div>
    </SectionCard>
  );

  const soundTabContent = (
    <SectionCard title={t.settingsSoundSection}>
      <label className="flex items-center gap-1.5 cursor-pointer">
        <input
          type="checkbox"
          checked={formData.soundEffects}
          onChange={(e) => {
            soundManager.setEnabled(e.target.checked);
            if (e.target.checked) soundManager.playSuccess();
            handleChange('soundEffects', e.target.checked);
          }}
          onBlur={() => handleBlur('soundEffects')}
        />
        <span>{t.settingsSoundEnable}</span>
      </label>
    </SectionCard>
  );

  const securityTabContent = (
    <div className="space-y-1.5">
      <SectionCard title={t.settingsSecurity}>
        <label className="flex items-center gap-1.5 cursor-pointer font-bold text-amber-400">
          <input
            type="checkbox"
            checked={formData.appLockEnabled}
            disabled={!formData.appPasswordHash && !formData.appLockEnabled}
            onChange={(e) => {
              if (e.target.checked && !formData.appPasswordHash) {
                soundManager.playBeep(220, 0.2);
                window.alert(t.settingsAppLockNeedsPassword);
                return;
              }
              handleChange('appLockEnabled', e.target.checked);
            }}
            onBlur={() => handleBlur('appLockEnabled')}
          />
          <span>{t.settingsAppLock}</span>
        </label>

        {formData.appLockEnabled && (
          <div className="p-1.5 bg-black/60 rounded border border-amber-400/40 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <div>
              <span className="text-[var(--fs-8)] opacity-70 block font-bold mb-0.5">{t.settingsAppUser}</span>
              <input
                type="text"
                value={formData.appUsername || 'admin'}
                onChange={(e) => handleChange('appUsername', e.target.value)}
                onBlur={() => handleBlur('appUsername')}
                className="w-full px-1.5 py-0.5 bg-black/70 border border-white/20 rounded text-xs text-white font-mono"
              />
            </div>
            <div>
              <span className="text-[var(--fs-8)] opacity-70 block font-bold mb-0.5">{t.settingsAppPass}</span>
              <div className="relative">
                <input
                  type={touched.newPassword ? 'text' : 'password'}
                  value={formData.newPassword}
                  placeholder={formData.appPasswordSalt ? t.settingsAppPassSet : t.settingsAppPassNone}
                  onChange={(e) => handleChange('newPassword', e.target.value)}
                  onBlur={() => handleBlur('newPassword')}
                  className="w-full px-1.5 py-0.5 bg-black/70 border border-white/20 rounded text-xs text-white font-mono pr-7"
                />
                <button
                  type="button"
                  onClick={() => setTouched(prev => ({ ...prev, newPassword: !prev.newPassword }))}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-amber-300 hover:text-amber-100"
                  aria-label="Toggle password visibility"
                >
                  {touched.newPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
                {errors.newPassword && <span className="text-[var(--fs-8)] text-rose-300 mt-0.5 block">{errors.newPassword}</span>}
              </div>
            </div>
            <div className="sm:col-span-2">
              <span className="text-[var(--fs-8)] opacity-70 block font-bold mb-0.5">{t.settingsAppPass}</span>
              <div className="relative">
                <input
                  type={touched.confirmPassword ? 'text' : 'password'}
                  value={formData.confirmPassword}
                  placeholder={t.settingsAppPassNone}
                  onChange={(e) => handleChange('confirmPassword', e.target.value)}
                  onBlur={() => handleBlur('confirmPassword')}
                  className="w-full px-1.5 py-0.5 bg-black/70 border border-white/20 rounded text-xs text-white font-mono pr-7"
                />
                <button
                  type="button"
                  onClick={() => setTouched(prev => ({ ...prev, confirmPassword: !prev.confirmPassword }))}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-amber-300 hover:text-amber-100"
                  aria-label="Toggle password visibility"
                >
                  {touched.confirmPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
                {errors.confirmPassword && <span className="text-[var(--fs-8)] text-rose-300 mt-0.5 block">{errors.confirmPassword}</span>}
              </div>
            </div>
          </div>
        )}
      </SectionCard>
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
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-row rounded shadow-2xl border text-[var(--fs-sm)] overflow-hidden"
        style={{ backgroundColor: theme.modalBg, borderColor: theme.modalBorder, color: theme.itemText }}>
        
        {/* Sidebar - Vertical Tabs */}
        <div className="flex flex-col gap-0.5 bg-black/30 p-1 border-r border-white/10 shrink-0 min-w-[140px]">
          {TAB_CONFIG.map(tab => (
            <SettingsTabButton
              key={tab.id}
              active={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              icon={tab.icon}
              label={tab.label}
            />
          ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Content */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {tabContent[activeTab]}
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between px-2 py-1.5 border-t text-[var(--fs-sm)] shrink-0"
            style={{ backgroundColor: theme.modalBg, borderColor: theme.modalBorder }}>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  const blob = new Blob([JSON.stringify(formData, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'omnicmd-settings.json';
                  a.click();
                  URL.revokeObjectURL(url);
                  soundManager.playKeyTick();
                }}
                className="px-1.5 py-0.5 border rounded cursor-pointer text-[var(--fs-8)]"
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
                      setFormData(prev => ({ ...prev, ...parsed }));
                      soundManager.playSuccess();
                    } catch {
                      alert(t.settingsInvalidConfig);
                    }
                  };
                  input.click();
                }}
                className="px-1.5 py-0.5 border rounded cursor-pointer text-[var(--fs-8)]"
              >
                {t.settingsImportConfig}
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleCancel}
                className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded font-semibold cursor-pointer"
              >
                <X className="w-3 h-3 mr-0.5" /> {t.btnCancel}
              </button>
              <button
                onClick={handleSave}
                className="px-3 py-1 bg-amber-400 hover:bg-amber-300 text-black font-extrabold rounded cursor-pointer shadow flex items-center gap-0.5"
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