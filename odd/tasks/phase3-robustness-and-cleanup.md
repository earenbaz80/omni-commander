# Phase 3 — Robustness and cleanup

Objective: close the remaining audit backlog — zombie jobs, unbounded caches/maps, UNC
network escape, missing Electron navigation guard, and the low-impact quality items.
Branch: `master` (repo precedent: direct work-unit commits, no PR).
Test runner: `npx vitest run --maxWorkers=2 --reporter=dot`.

## Specs

S1. **A parked conflict must not wait forever.**
`server.cjs` `awaitConflictAnswer` (~:817) currently loops
`while (!job.cancelled && job.pendingConflict) await sleep(120);` with no deadline.
A dead or disconnected UI leaves the job in `waiting` for the lifetime of the process.
Required: an unanswered conflict expires after a bounded timeout (`CONFLICT_ANSWER_MS`,
default 5 minutes) and the job is marked failed with a clear error instead of hanging.
Cancellation must still win immediately, and a normal answer must still resolve normally.

S2. **The jobs map must stay genuinely bounded.**
`makeJob` (~:700) prunes with
`if (jobs.size > 200) { for (...) { if (finished) { jobs.delete(key); break; } } }` —
a single deletion per creation, and the `break` means only one entry can ever be dropped.
Required: prune in a loop until the map is back under the cap, never evicting
`running`/`paused` jobs, and treat a job parked in `waiting` on a conflict as non-evictable
too (it is live work). `JOBS_LIMIT` must be a named constant.

S3. **The server listing cache must bound its own lifetime.**
`server.cjs` `listCache` (~:359) only deletes an entry on read error or a filesystem
mutation (`listCache.clear()` at :470). `LIST_CACHE_MS` (`2000`) gates freshness, not
retention, so browsing hundreds of directories keeps every listing forever.
Required: cap the map by size (`LIST_CACHE_LIMIT`, default 200 entries) and evict the
oldest entries when the cap is exceeded, in addition to the existing freshness and
mutation rules.

S4. **Absolute local paths must exclude UNC/network shares.**
`server.cjs` `isAbsoluteLocalPath` (~:759) returns true for
`/^\\\\[^\\]/.test(text)`, so copy/delete/mkdir/write can reach `\\host\share` over SMB.
The product constraint is loopback-only, fully offline. Required: only a drive-letter
absolute path (`^[a-zA-Z]:[\\/]`) is accepted; UNC and device paths (`\\?\`, `\\.\`)
are rejected by `assertSafePath` with the existing `Unsafe path` error.

S5. **The Electron window must refuse remote navigation.**
`electron/main.cjs` (~:69) has no `will-navigate` / `setWindowOpenHandler` guard.
Required: deny every navigation whose target is not one of the two legitimate local
origins (`http://localhost:3000` in dev, the packaged `file://` index in production),
and set `setWindowOpenHandler` to `{ action: 'deny' }` so `window.open` cannot leave the app.

S6. **Silent catch blocks must leave a diagnostic trail.**
`server.cjs` swallows probe/WMI failures at `:206`, `:288` and `:320` with `catch {}`.
Required: each of those logs a concise message at debug level so a failing WMI query is
visible, without changing control flow or output.

S7. **The empty-probe WMI fallback must respect the inflight guard.**
`server.cjs` `computeRealDrives` (~:315) calls `queryWmiDriveInfo()` directly, bypassing
`wmiInflight`, so it can stack a second PowerShell alongside the background warm-up at
`:1184`. Required: route the fallback through `enrichDrivesFromWmi`-style guarded access
(or otherwise share the `wmiInflight` flag) so at most one WMI query runs at a time,
while `computeRealDrives` still receives the metadata it needs.

S8. **Named constants for the magic numbers.**
`server.cjs` uses unnamed literals (`120`, `3000`, `200`, `4000`, `8000`, `60000`,
`300000`, …) across polling, probing and retention logic. Required: extract the ones tied
to timers, limits and timeouts into named top-level constants documenting their unit.

S9. **Unify the three transfer executors in `App.tsx`.**
`src/App.tsx:365-639` contains three near-identical executors
(`enqueueTransferPlan`, `handleConfirmCopy`, `handleConfirmMove`) that each re-implement
pause-polling, conflict prompting, speed/ETA meta and error handling; the copy/move/replay
distinction is data, not three closures. Required: one shared executor driven by a plan
object, preserving the exact observable behaviour (task queue entries, conflict prompt
lifecycle, progress meta, success/error handling). Behaviour-preserving refactor only —
no user-visible change.

## Tasks

| ID | Specs | Route | Status | Evidence |
|----|-------|-------|--------|----------|
| T1 | S1, S2, S3 | inline | done | server.cjs: conflict deadline + `CONFLICT_ANSWER_MS`; `while (jobs.size > JOBS_LIMIT)` prune skipping live work; `LIST_CACHE_LIMIT` + `pruneListCache()` skipping `inflight` entries. `node --check` 0. |
| T2 | S4, S6, S7, S8 | inline | done | server.cjs: `isAbsoluteLocalPath` now `^[a-zA-Z]:[\\/]` only; `logDebug()` at `OMNI_DEBUG` applied to the WMI + statfs catches; WMI fallback wrapped in the `wmiInflight` guard; `JOB_TICK_MS` / `POWERSHELL_TIMEOUT_MS` / `WMI_TIMEOUT_MS` named and applied. `node --check` 0. |
| T3 | S5 | inline | done | electron/main.cjs: `isAllowedLocalUrl()` + `will-navigate` preventDefault + `setWindowOpenHandler` deny. `node --check` 0. |
| T4 | S9 | inline | done | App.tsx: one `enqueueTransferPlan(plan, replay)` executor plus `runConfirmedTransfer(op, ...)` for the catalogue path; `handleConfirmCopy`/`handleConfirmMove` are now one-line delegations. Net −29 lines. |
| T5 | gates + commits + rebuild | inline | done | tsc 0, strict tsc 0, eslint 0, vitest 22 files / 139 tests exit 0 (first run hit the known forks-pool flake, retry clean). |

## Log

L1 (user, verbatim): "bueno adelante con todo eso" — authorization to implement the whole
Phase 3 backlog (audit points 1-9) after the parent listed them in reply to "que falta?".

L2 (parent): mapped the exact code sites before writing any spec — `awaitConflictAnswer`
server.cjs:817-826; `makeJob` prune server.cjs:733-739; `listCache` server.cjs:359-360,
401-410, 470; `isAbsoluteLocalPath` server.cjs:759-762 + `assertSafePath` :766-769;
`electron/main.cjs:69` window creation with no navigation guard; silent catches at
server.cjs:206, 288, 320; unguarded `queryWmiDriveInfo()` fallback at server.cjs:315;
App.tsx transfer executors.

L3 (parent, T1+T2+T3): all server and Electron specs implemented inline. Closed the UNC
escape by deleting the `\\host\share` branch entirely rather than whitelisting it, since the
product's stated constraint is loopback-only and fully offline. The WMI fallback now shares
`wmiInflight` so the background warm-up and the on-demand probe can never race two
PowerShell processes. Two intentional scoping decisions: the `catch {}` at server.cjs:399
(`fs.promises.stat`) and :1001 (`utimes`) stay silent — both are best-effort refinements
where a missing timestamp is not a failure; and the magic numbers inside `dashboardHtml()`'s
embedded browser script were left alone, since they are page-local and not server policy.

L4 (parent, T4): unified the three transfer executors. The refactor keeps the two real
behavioural differences explicit rather than hidden: the replay path additionally refreshes
the target (and, for moves, source) directory in `finally`, and the catalogue path is the
only one that calls `setActiveModal(null)`. Discovered during the refactor that the live
copy/move path never used the plan's entry paths — it always went through
`fsEngine.copyItem`/`moveItem` with `item.id` — so `runConfirmedTransfer` still builds a plan
for the task record but only uses it for the real-drive replay branch; the catalogue branch
remains byte-for-byte equivalent to before. `TransferFile` was not a real type; the callback
entry type is `FileProgressEntry` from `./types`.

L5 (parent, T5): gates — `npx tsc --noEmit` 0; `npx tsc --noEmit -p tsconfig.strict.json` 0;
`npx eslint src` 0; `npx vitest run --maxWorkers=2 --reporter=dot` → 22 files / 139 tests
passed, exit 0. The first suite run exited 1 with 121 tests passed and
`Failed to start forks worker for test files` — the known vitest pool flake on this machine,
not a regression; the immediate retry was clean. `node --check server.cjs` and
`node --check electron/main.cjs` both exit 0.

L6 (parent): `handleConfirmDelete` was deliberately left untouched — it is byte-less
(progress is measured in entries, not bytes) and shares no code with the transfer executors,
so folding it in would have meant inventing a shared abstraction for a genuinely different
operation.
