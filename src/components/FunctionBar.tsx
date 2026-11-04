import React from 'react';
import type { LanguageCode } from '../types';
import { ThemeConfig } from '../services/themeManager';
import { getTranslations, type TranslationKey } from '../i18n/translations';

export interface FunctionKey {
  key: string;
  /** Translation key, not copy: the bar renders it through the table. */
  label: TranslationKey;
  action?: () => void;
  disabled?: boolean;
  visible?: boolean;
}

interface FunctionBarProps {
  theme: ThemeConfig;
  lang: LanguageCode;
  keys: FunctionKey[];
  className?: string;
}

export const FunctionBar: React.FC<FunctionBarProps> = ({ theme, lang, keys, className = '' }) => {
  const t = getTranslations(lang);

  return (
    <div
      className={`flex flex-wrap items-center gap-[var(--space-1)] px-[var(--space-2)] py-[var(--space-2)] border-t ${className}`}
      style={{
        backgroundColor: theme.statusBg,
        borderColor: theme.borderPanel,
        color: theme.statusText,
      }}
      role="toolbar"
      aria-label={t.functionBarAriaLabel || 'Barra de funciones'}
    >
      {keys.map((fn) => (
        <button
          key={fn.key}
          type="button"
          onClick={fn.action}
          disabled={fn.disabled}
          style={{ display: fn.visible === false ? 'none' : 'inline-flex' }}
          className={`flex items-center justify-center gap-[var(--space-1)] px-[var(--space-2)] py-[var(--space-1)] rounded text-[var(--fs-8)] font-bold cursor-pointer transition-colors select-none ${
            fn.disabled ? 'opacity-30 cursor-not-allowed' : 'bg-black/30 hover:bg-white/10 border border-white/10'
          }`}
          aria-label={`${fn.key}: ${t[fn.label]}`}
        >
          <kbd className="bg-white/5 border border-white/10 rounded px-[var(--space-1)]">{fn.key}</kbd>
          <span className="opacity-90">{t[fn.label]}</span>
        </button>
      ))}
    </div>
  );
};
