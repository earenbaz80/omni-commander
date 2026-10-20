# Phase 1 — Security & Data Integrity

Objective: fix the CRITICAL/HIGH findings from the 4-part code audit (security of the loopback API, copy integrity, AppLock bypass, fake checksums, unbounded caches, crash/perf bugs). Branch: `master` (direct work-unit commits, repo precedent; no PR). Test runner: `npx vitest run --maxWorkers=2 --reporter=dot` (default worker count is flaky — always pass `--maxWorkers=2`).

## Specs

### S1 — Loopback API must reject remote origins (CRITICAL)
`server.cjs` `isAllowedOrigin` trusts the literal `Origin: null` (server.cjs:17) and echoes it as `Access-Control-Allow-Origin` (server.cjs:39), so any web page's sandboxed iframe (opaque origin) can invoke `/api/fs/delete`, `/api/fs/write`, `/api/fs/copy` on loopback.

Requirement: a remote web page (any non-loopback origin, including `Origin: null`) can NEVER invoke the loopback API. Implementation: per-launch random session token generated at app start, handed to `preload.cjs` via process argv (same mechanism as `--omni-api-port`), exposed to the renderer, and required as a header on every mutating (POST) request; missing/wrong token → 403. Explicitly reject `Origin: null`. The server's own dashboard (same-origin GETs) and the legit renderer (dev origin `localhost:3000` and packaged file origin) must keep working with zero regressions. Adding the header centrally in `src/utils/fetchWithRetry.ts` is allowed.

Acceptance: POST without token → 403; POST with token → passes auth; `Origin: null` and remote origins rejected; drives/listing/copy/delete still work in the app.

### S2 — Copy must not destroy the destination before completion (HIGH)
`server.cjs:832` overwrites in place: `fs.createWriteStream(dest)` truncates the existing file before the first byte arrives; a cancel, crash or server death mid-transfer leaves a truncated destination and the original content is gone.

Requirement: copies/overwrites write to a same-directory temp name first and `fs.rename` into place only on completion; on failure or cancel the temp is deleted and the original destination remains untouched. Document interrupted-job recovery (temp naming convention) in a code comment.

Acceptance: killing a transfer mid-copy leaves the original destination intact and a removable temp file; a completed copy produces the final file with the correct bytes.

### S3 — A write error must fail the job, not kill the server (HIGH)
`server.cjs:838`: the writer stream has no persistent `'error'` listener; an async write failure (e.g. ENOSPC) outside the `once(writer, 'drain')` window is an unhandled stream error that kills the whole in-process server and every running job.

Requirement: every reader/writer stream error during a transfer rejects that job with a clear error surfaced to the client, and never crashes the process. Prefer `stream.pipeline(reader, writer, cb)` or an equivalent permanent error binding. Applies to copy and any other streaming write path.

Acceptance: a simulated write failure (e.g. temp stream emitting `error`) marks the job error'd with a message; the server and other jobs stay alive.

### S4 — AppLock must not have a default-password bypass (HIGH)
Enabling the lock with no password set unlocks with the hardcoded public default `admin123` (username default `admin`) — src/App.tsx:817 + src/components/modals/AppLockModal.tsx:41 — a credential bypass of the whole lock feature.

Requirement: reject unlock when `appPasswordHash` is empty; require a password at enable time; the string `admin123` must not unlock or enable anything anywhere. Existing PBKDF2 behavior (SHA-256, 100k iterations, 16-byte salt, constant-time compare) stays as-is.

Acceptance: enable flow refuses to activate without a password; unlock with no stored hash fails; no code path unlocks with `admin123`.

### S5 — Checksums must be hashes of file bytes (HIGH)
`src/services/fileSystemCrypto.ts:9` computes SHA-1/SHA-256 over the fallback string `name.ext_size_modifiedAt` because `/api/list` returns `content: ''` (server.cjs:360) for real files, so ChecksumModal displays digests that are NOT hashes of the file's bytes; `:37` presents a 32-bit JS hash padded with the literal prefix `a7f9b2c4180e` to the user as MD5 — it never matches a real MD5.

Requirement: for real-drive files, ChecksumModal shows genuine SHA-1, SHA-256 AND MD5 of the file's bytes, computed server-side with Node's built-in `crypto` (new route, e.g. `GET /api/fs/hash?path=...`, streaming the file; path validation same as other fs routes; subject to the S1 origin rules). For in-memory/virtual files that actually have `content`, keep hashing the content in the renderer. Never fabricate a digest: if bytes cannot be read, show an error instead of a fake value. No invented prefixes.

Acceptance: hashing a known file (e.g. a fixture whose MD5/SHA-256 are known) returns the real digests on all three rows; in-memory files still hash without a server call.

### S6 — The listing cache and localStorage persist must be bounded (HIGH)
`src/services/fileSystem.ts:200`: `files` accumulates every directory ever listed with no eviction (each `loadSystemDriveDirectory` only replaces its own bucket) and the whole array is JSON-persisted to localStorage, so quota is eventually exceeded while `persistToStorageNow` (fileSystem.ts:129) swallows the failure silently, losing drives/files/trash.

Requirement: bound the listing cache (LRU per directory — evict least-recently-used directory buckets past a sensible cap, e.g. ~200 directories; currently-viewed/referenced tabs may reload from the server on demand); strip heavy/non-visible fields (notably `content`) from what gets written to localStorage; persist failures are no longer silent (log via the project logger, keep app functional). Trash/virtual entries must not be evicted by the LRU. Existing tests stay green; add RED-first tests for the cap and the stripped payload.

Acceptance: listing > cap directories keeps `files` length bounded; serialized localStorage payload contains no `content` field; a quota-exceeded persist logs instead of failing silently.

### S7 — Alt+F1/F2 must not crash with zero drives (HIGH)
`src/hooks/useKeyboardShortcuts.ts:171`: `(findIndex + 1) % drives.length` with an empty drive list is `% 0` → NaN → `drives[NaN].id` throws a TypeError in the window keydown handler (`initialDrives` is `[]`, so a fresh install hits this before the first successful poll).

Requirement: guard both Alt+F1 and Alt+F2 paths with `if (!drives.length) return;` (or equivalent) before the modulo.

Acceptance: with `drives = []`, pressing Alt+F1/Alt+F2 is a clean no-op (no throw).

### S8 — Drag-drop move must not run its cleanup twice (HIGH)
`src/App.tsx:730-748`: `handleDropItems` runs the move-cleanup block twice — the async IIFE does it correctly after the loop (App.tsx:710-727), and an identical copy runs synchronously right after, so `playSuccess` + `setFsTick` fire before any move/copy has even started (and `playSuccess` also fires for copies, which the inner block correctly skips).

Requirement: delete the synchronous duplicate (App.tsx:730-748), keeping the async version. Success feedback fires only after the operation actually completed, and only for moves.

Acceptance: one cleanup pass per drop; no success sound before the transfer is dispatched; copies do not play the move-success sound.

### S9 — Brief view must be virtualized (HIGH)
`src/components/FileList.tsx:736`: `brief` mode is not virtualized — it renders every item with `items.map(...)` inside a CSS grid, so a 50k-file directory mounts 50k DOM nodes with ~10 handlers each. The existing `gridRowVirtualizer` even computes `gridRowCount` for brief (FileList.tsx:174).

Requirement: virtualize brief with the existing `gridRowVirtualizer`, slicing with `base = virtualRow.index * gridColumns`. Column count used for slicing MUST match the rendered grid (pick one source of truth — inline `gridTemplateColumns: repeat(N, minmax(0,1fr))` like gallery does; brief currently hard-codes `3` in `getGridColumns()` while the CSS says `grid-cols-2 md:grid-cols-3` — resolve the mismatch in favor of the computed count). Preserve every per-item handler (click, drag start/over/leave/drop, focus/selection visuals) exactly as today. Visual layout at default zoom stays the same (3 columns, same gaps/padding).

Acceptance: brief with N items renders ~N/gridColumns row containers, not N items; keyboard focus, drag-drop and selection still work; `npx vitest run` full suite green.

## Tasks

| ID | Specs | Route | Status | Commit |
|----|-------|-------|--------|--------|
| T1 | S1, S2, S3, S5 | delegated writer A (server + checksums) | pending | |
| T2 | S4, S6, S7, S8 | delegated writer B (renderer safety) | pending | |
| T3 | S9 | inline (parent) | DONE (gates green, uncommitted) | |
| T4 | all | parent: gates + seam check + work-unit commits | pending | |

Writer A surfaces: `server.cjs`, `electron/main.cjs`, `electron/preload.cjs`, `src/services/fileSystemCrypto.ts`, `src/components/modals/ChecksumModal.tsx`, `src/utils/fetchWithRetry.ts`, new test `src/services/fileSystemCrypto.test.ts`.
Writer B surfaces: `src/App.tsx`, `src/components/modals/AppLockModal.tsx`, `src/components/modals/AppLockModal.test.tsx`, `src/hooks/useKeyboardShortcuts.ts`, `src/services/fileSystem.ts`, `src/services/fileSystem.test.ts`, `src/services/fileSystem.realDrive.test.ts`.
Parent: `src/components/FileList.tsx`, `src/components/FileList.columns.test.tsx` (if a RED test is feasible).

Out of scope (Phase 2+): conflict TTL, jobs-map prune, UNC rejection, port-3001 fallback, `listCache` lifetime, trash/restore bugs, ZIP fake-success, `fetchWithRetry` loopback assert, gallery zoom no-op, i18n hardcodes, hover re-render, `useTransferQueue` refactor, hot-plug drive detection (approved earlier, queued separately).

## Log

L1 (2026-10-19, user): "fase 1" — approving the Phase 1 plan presented after the 4-part audit (9 items: CORS Origin:null CRITICAL; in-place overwrite; missing stream error handler; AppLock admin123 bypass; fake checksums/MD5; unbounded files cache + silent persist failure; Alt+F1/F2 %0 crash; duplicated move-cleanup block; non-virtualized brief view).

L2: T3/S9 done inline. `FileList.tsx` brief mode now virtualized via `gridRowVirtualizer` (row containers with `base = virtualRow.index * gridColumns`, `gridTemplateColumns: repeat(${gridColumns}, minmax(0,1fr))`, gap 2px, padding 4px), preserving every per-item handler and visual state. Added `briefColumns = containerWidth >= 768 ? 3 : 2` so slicing matches the old `grid-cols-2 md:grid-cols-3` breakpoint; `getGridColumns()` returns `briefColumns` for brief. Gates: `npx tsc --noEmit` 0, `npx eslint src/components/FileList.tsx` 0. Not committed. Engram mirror pending: mem_save failed with "could not resolve an authoritative OpenCode runtime session".
