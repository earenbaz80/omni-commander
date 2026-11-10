# Agent notes

## Commit messages

Conventional commits, in English and imperative: `test(e2e): ...`, `fix(server): ...`,
`feat(panel): ...`. The subject says what changed; the body says why it was needed and
what it now guarantees, wrapped at about 80 columns.

**No assistant attribution.** Do not add "Generated with ..." lines, emoji footers, or
`Co-Authored-By` trailers naming an AI tool or assistant. The message ends at its own last
paragraph; who or what typed it is not part of the history.

## Measuring the E2E suite

Timings are only comparable under the same conditions, so treat these as rules:

- **Isolated and in-suite timings do not mix.** A spec run on its own pays a cold page cache
  and an idle disk; the same spec inside the full suite runs next to other temp workspaces and
  a loaded machine. The same case has measured 11.9 s alone and 14.5-17.6 s in-suite. Compare a
  spec only against the same spec, run the same way.
- **One run per side proves nothing.** Identical code has produced full-suite totals from 177 s
  to 217 s (SD around 14 s). A change worth a few seconds is invisible in that total, and a
  median of two runs is just their mean.
- **Run the sides interleaved**, `A B A B A`, rather than all of A then all of B, so drift in
  machine state hits both sides equally, with nothing else open while the suite runs.
- **Judge a change by the case it touches**, not by the suite total: a 7 s win in one case cannot
  be resolved in a ~200 s total without hundreds of pairs. For the total, report mean, SD and a
  95% confidence interval (t, n-1 df) with at least five pairs, and say so when the interval
  crosses zero.
- **Disk-bound cases vary by design.** Archive extraction and the case that walks 21 windows
  swing by up to 40% between runs of the same code; measure them several times before calling a
  difference a regression.
