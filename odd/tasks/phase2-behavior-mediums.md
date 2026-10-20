# Phase 2 — Behavior MED findings

Objective: fix the three MEDIUM behavior defects the pre-release audit found in the hooks layer, plus the splitter write storm, without changing any user-visible behavior other than the two filters that silently did not apply.
Branch: `master` (repo precedent is direct work-unit commits, no PR).
Test runner: `npx vitest run --maxWorkers=2 --reporter=dot`.

## Specs

- **S1** `src/hooks/usePanels.ts:199` — `getPanelItems` is memoized on `[settings.showHiddenFiles]` alone, but its body reads `settings.showSystemFiles` at `:167`. Toggling "show system files" in Settings therefore does not re-filter the panels until some unrelated `fsTick`/tab change happens. Requirement: toggling either the hidden or the system filter re-filters both panels immediately.
- **S2** `src/hooks/useSplitter.ts:21` — every `mousemove` during a splitter drag calls `setSettings`, and `src/hooks/useSettings.ts:66-70` JSON-stringifies the whole settings object into `localStorage` on every `settings` change. Dragging the splitter therefore writes to localStorage once per pixel moved and re-renders the whole app per mousemove. Requirement: the drag stays smooth, the committed ratio is persisted once after the drag ends, and the pane width still follows the pointer live during the drag.
- **S3** `src/hooks/useKeyboardShortcuts.ts:380` — the keydown effect's dependency array lists 8 values but the handler closes over roughly 20 more props (`handleTriggerCopy`, `handleTriggerMove`, `handleTriggerDelete`, `handleNewTab`, `handleCloseTab`, `handleSelectAll`, `handleSwapPanels`, `handleSelectIndex`, `handleOpenItem`, `handleGoParent`, and the handler props generally). Correctness today is an accident of `currentActiveTab`/`activeItems`/`drives` changing identity on nearly every interaction. Requirement: the listener always sees the current handlers (latest-ref pattern), so a stale closure cannot fire an outdated action.
- **S4** The pre-existing follow-ups reported by the Phase 1 writers and recorded in `odd/tasks/phase1-security-integrity.md`: `src/hooks/useSettings.ts:41` still defaults `appPasswordHash` to `'admin123'` (neutralized at load by the App.tsx migration but it should be an empty string); `src/components/modals/SettingsModal.tsx:456` lets the "enable app lock" checkbox be ticked with no password set, so the user gets no feedback when the lock silently refuses to engage; and `src/hooks/useKeyboardShortcuts.ts:151` has `Alt+F7` shadowed by plain F7, the same dead-code class fixed for Alt+F1/F2.

## Tasks

| ID | Specs | Route | Status | Commit / Evidence |
|----|-------|-------|--------|-------------------|
| T1 | S1, S3 | inline | done | `usePanels.ts:199` deps now `[settings.showHiddenFiles, settings.showSystemFiles]`; `useKeyboardShortcuts.ts` uses a `dRef` latest-ref with effect deps `[]` and the destructuring moved into `handleKeyDown` |
| T2 | S2 | inline | done | `useSplitter.ts` rewritten: live `dragRatio` local state, single `setSettings` commit on mouseup; `App.tsx` consumes `ratio` |
| T3 | S4 | inline | done | `useSettings.ts:41` `appPasswordHash: ''`; `Alt+F7` unshadowed (`e.key === 'F7' && !e.altKey`); `SettingsModal.tsx` app-lock guard + `settingsAppLockNeedsPassword` in all 8 locales |
| T4 | — | inline (gates + commits) | done | Gates: tsc 0, strict tsc 0, eslint src 0, vitest 22 files / 139 tests passed |

## Log

- L1 (user, verbatim): "fase 2"
- L2: Evidence gathered before any edit: `usePanels.ts:199` deps `[settings.showHiddenFiles]` vs body reading `settings.showSystemFiles` at `:167`; `useSplitter.ts:21` `setSettings` per `mousemove` with `useSettings.ts:66-70` persisting the full object per change; `useKeyboardShortcuts.ts:380` dep array listing only `[activePanel, currentActiveTab, activeItems, activeFocusedItem, activeModal, isAppLocked, drives, leftTab, rightTab, quickSearchQuery]`.
- L3: T1 done. `usePanels.ts:199` dep `settings.showSystemFiles` added. `useKeyboardShortcuts.ts` converted to a latest-ref: `dRef` holds the current props, the effect closure reads `dRef.current` and destructures inside `handleKeyDown`, effect deps reduced to `[]`. First gate run failed strict tsc with `TS6198 All destructured elements are unused` and 31 eslint no-unused-vars: the old top-level destructuring block was left behind and became dead code. Deleted it; gates then clean.
- L4: T2 done. `useSplitter(setSettings, committedRatio)` keeps `dragRatio`/`dragRatioRef` local during the drag and commits once on mouseup; returns `ratio = dragRatio ?? committedRatio`. `App.tsx:131,904,964` updated to the returned `dualPaneRatio`, eliminating one `setSettings` + one full localStorage write per mousemove.
- L5: T3 done. Default `appPasswordHash` is now `''`; `Alt+F7` branch is reachable after adding `&& !e.altKey` to the plain F7 branch; the SettingsModal enable checkbox is disabled without a password and, if forced, beeps and alerts instead of silently refusing. New key `settingsAppLockNeedsPassword` added to en/es/fr/de/it/ja/ru/pt, kept in sync by `translations.test.ts`.
- L6: T4 done. Verification on the integrated tree: `npx tsc --noEmit` 0; `npx tsc --noEmit -p tsconfig.strict.json` 0; `npx eslint src` 0; `npx vitest run --maxWorkers=2 --reporter=dot` exit 0 with 22 test files / 139 tests passed (65.10 s). The `Failed to parse URL from /api/fs/mkdir|delete` stderr lines are pre-existing jsdom noise from tests exercising failure paths, not failures.
- L7: User approved closure with "si cierra fase 2".
