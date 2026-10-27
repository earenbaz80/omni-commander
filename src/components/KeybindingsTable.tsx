import React, { useState, useMemo } from 'react';
import { ThemeConfig } from '../services/themeManager';
import { getTranslations } from '../i18n/translations';
import { Search } from 'lucide-react';

interface Keybinding {
  category: string;
  key: string;
  description: string;
  preset?: string;
}

interface KeybindingsTableProps {
  theme: ThemeConfig;
  lang: string;
  keybindings: Keybinding[];
  categories: string[];
  filterPreset?: string;
  onFilterChange?: (preset: string) => void;
  presets?: string[];
}

export const KeybindingsTable: React.FC<KeybindingsTableProps> = ({
  theme,
  lang,
  keybindings,
  categories,
  filterPreset,
  onFilterChange,
  presets = [],
}) => {
  const t = getTranslations(lang as any);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');

  const filtered = useMemo(() => {
    return keybindings.filter((kb) => {
      const matchesCategory = activeCategory === 'all' || kb.category === activeCategory;
      const matchesSearch =
        !search ||
        kb.key.toLowerCase().includes(search.toLowerCase()) ||
        kb.description.toLowerCase().includes(search.toLowerCase());
      const matchesPreset = !filterPreset || !kb.preset || kb.preset === filterPreset;
      return matchesCategory && matchesSearch && matchesPreset;
    });
  }, [keybindings, activeCategory, search, filterPreset]);

  const grouped = useMemo(() => {
    const groups: Record<string, Keybinding[]> = {};
    filtered.forEach((kb) => {
      if (!groups[kb.category]) groups[kb.category] = [];
      groups[kb.category].push(kb);
    });
    return groups;
  }, [filtered]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar: búsqueda + filtros */}
      <div className="flex flex-wrap gap-[var(--space-2)] p-[var(--space-2)] bg-black/30 rounded border border-white/10 mb-[var(--space-2)]">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-[var(--space-2)] top-1/2 -translate-y-1/2 w-4 h-4 opacity-50" />
          <input
            type="text"
            placeholder={t.keybindingsSearchPlaceholder || 'Buscar atajo...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-[var(--space-2)] py-[var(--space-1)] pl-[var(--space-8)] bg-black/50 border border-white/20 rounded text-xs text-white font-mono outline-none focus:border-amber-400"
            aria-label={t.keybindingsSearchAria || 'Buscar atajos'}
          />
        </div>
        <select
          value={activeCategory}
          onChange={(e) => setActiveCategory(e.target.value)}
          className="px-[var(--space-2)] py-[var(--space-1)] bg-black/50 border border-white/20 rounded text-xs text-amber-300 font-mono font-bold"
        >
          <option value="all">{t.keybindingsAllCategories || 'Todas las categorías'}</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
        {presets.length > 0 && onFilterChange && (
          <select
            value={filterPreset || 'all'}
            onChange={(e) => onFilterChange(e.target.value)}
            className="px-[var(--space-2)] py-[var(--space-1)] bg-black/50 border border-white/20 rounded text-xs text-amber-300 font-mono font-bold"
          >
            <option value="all">{t.keybindingsAllPresets || 'Todos los presets'}</option>
            {presets.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Tabla de atajos */}
      <div className="flex-1 overflow-y-auto">
        {Object.keys(grouped).length === 0 ? (
          <div className="p-[var(--space-4)] text-center opacity-50 text-[var(--fs-sm)]">
            {t.keybindingsNoResults || 'No hay atajos que coincidan'}
          </div>
        ) : (
          Object.entries(grouped).map(([category, items]) => (
            <div key={category} className="mb-[var(--space-3)]">
              <h4 className="font-bold text-amber-300 uppercase tracking-wider text-[var(--fs-8)] px-[var(--space-2)] mb-[var(--space-1)] border-b border-white/10">
                {category}
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-1)] px-[var(--space-1)]">
                {items.map((item, idx) => (
                  <div
                    key={`${category}-${idx}`}
                    className="p-[var(--space-2)] bg-black/40 rounded border border-white/10 flex items-center gap-[var(--space-2)]"
                  >
                    <kbd className="px-[var(--space-2)] py-[var(--space-1)] bg-black/60 border border-amber-400/40 text-amber-300 font-bold rounded text-[var(--fs-8)] shrink-0 min-w-[60px] text-center">
                      {item.key}
                    </kbd>
                    <span className="text-[var(--fs-sm)] opacity-90 truncate">{item.description}</span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
