#!/bin/sh
# Twin of cpu-sampler.ps1 for machines that push without PowerShell: same
# purpose, same CSV columns, same summary, so a failed push reads the same
# whichever OS produced it.
#
# `ps`, not pidstat or top. pidstat comes with sysstat and is missing from a
# stock install on most distributions, which would leave the diagnosis silently
# absent on exactly the machines that need it; `top -b` pads its columns to the
# terminal width, so a parser tuned in one session breaks in another. The delta
# of an accumulated CPU time from `ps` is the same measurement the PowerShell
# version takes, and `-A -o pid=,comm=,rss=,time=` answers on Linux and macOS
# alike (`-e` does not mean "everything" on BSD).
#
#   sh scripts/cpu-sampler.sh --seconds 700 --out cpu.log
#
# Columns: ts,freeMb,totalCs,top. `top` holds up to fifteen `name=pid=cs=wsMb`
# entries, the busiest first. --stop-file ends the run as soon as that file
# exists and still prints the summary: the hook needs the verdict at the moment
# the suite fails, not at the end of a deadline, and killing the process would
# throw the summary away with it.
#
# freeMb is blank where /proc/meminfo does not exist, which is every macOS box.
set -u

seconds=700
out=cpu-samples.log
stop_file=
top_n=15

while [ "$#" -gt 0 ]; do
  case "$1" in
    --seconds) seconds=$2; shift 2 ;;
    --out) out=$2; shift 2 ;;
    --stop-file) stop_file=$2; shift 2 ;;
    --top) top_n=$2; shift 2 ;;
    *)
      echo "cpu-sampler: unknown option $1" >&2
      echo "usage: $0 [--seconds N] [--out FILE] [--stop-file FILE] [--top N]" >&2
      exit 2
      ;;
  esac
done

work=$(mktemp -d) || exit 1
trap 'rm -rf "$work"' EXIT INT TERM
prev="$work/prev"
agg="$work/agg"
snap="$work/snap"
prog="$work/sampler.awk"
: >"$prev"
: >"$agg"

# The snapshot is read every tick and the previous one is kept on disk, because
# a process that exits leaves nothing behind otherwise: summing accumulated
# times over a set that keeps losing members is not monotonic, and the total
# would go backwards instead of naming who worked. Time is parsed from
# `[[dd-]hh:]mm:ss` into centiseconds, the same unit the CSV already uses.
cat >"$prog" <<'AWK'
function parse_time(t,   d, cut, n, a) {
  d = 0
  cut = index(t, "-")
  if (cut > 0) { d = substr(t, 1, cut - 1) + 0; t = substr(t, cut + 1) }
  n = split(t, a, ":")
  if (n == 3) return (d * 24 + a[1]) * 360000 + a[2] * 6000 + a[3] * 100
  return d * 8640000 + a[1] * 6000 + a[2] * 100
}

# Bounded insertion, busiest first: a full sort per tick for a list this short
# costs more than the fifteen comparisons it takes to keep it ordered.
function insert(cs, entry,   i) {
  if (ntop < maxtop) ntop++
  else if (cs <= topcs[ntop]) return
  i = ntop
  while (i > 1 && topcs[i - 1] < cs) {
    topcs[i] = topcs[i - 1]
    topent[i] = topent[i - 1]
    i--
  }
  topcs[i] = cs
  topent[i] = entry
}

BEGIN { ntop = 0 }

FILENAME == prevfile { prev[$1] = $2; next }
FILENAME == aggfile  { acs[$1] = $2; apeak[$1] = $3; next }

{
  cs = parse_time($NF)
  pid = $1
  rss = $(NF - 1)
  # `comm` is a single field on both systems; the join only matters if some
  # build ever prints one with a space in it, and then one name beats two.
  name = ""
  for (i = 2; i <= NF - 2; i++) name = (name == "" ? $i : name "_" $i)
  if (name == "") name = "?"
  raw[pid] = cs
  # The first pass only fills the previous snapshot: without it every process
  # is new on the first window and its whole lifetime lands there, which made
  # explorer claim three hours of CPU in a two-minute run.
  if (warm) next
  was = prev[pid]
  delta = (was != "" && cs >= was) ? cs - was : cs
  if (delta <= 0) next
  total += delta
  nm[pid] = name
  dl[pid] = delta
  ws[pid] = int(rss / 1024)
  insert(delta, name "=" pid "=" delta "=" ws[pid])
}

END {
  for (p in raw) print p, raw[p] > prevfile
  if (warm) exit
  for (p in dl) {
    n = nm[p]
    acs[n] += dl[p]
    if (ws[p] > apeak[n]) apeak[n] = ws[p]
  }
  for (n in acs) print n, acs[n], apeak[n] > aggfile
  entry = ""
  for (i = 1; i <= ntop; i++) entry = (entry == "" ? topent[i] : entry ";" topent[i])
  printf "%s,%s,%d,%s\n", ts, freemb, total, entry >> outfile
}
AWK

printf 'ts,freeMb,totalCs,top\n' >"$out"

tick=0
failed=0
deadline=$(( $(date +%s) + seconds ))

while [ "$(date +%s)" -lt "$deadline" ]; do
  if [ -n "$stop_file" ] && [ -e "$stop_file" ]; then
    break
  fi
  tick=$((tick + 1))

  free_mb=
  if [ -r /proc/meminfo ]; then
    free_mb=$(awk '/^MemAvailable:/ { printf "%d", $2 / 1024; exit }' /proc/meminfo)
  fi

  if ! ps -A -o pid=,comm=,rss=,time= >"$snap" 2>/dev/null; then
    echo "cpu-sampler: ps could not list processes on this system" >&2
    failed=1
    break
  fi

  warm=0
  [ "$tick" -eq 1 ] && warm=1

  awk -v prevfile="$prev" -v aggfile="$agg" -v outfile="$out" \
      -v ts="$(date +%H:%M:%S)" -v freemb="$free_mb" -v warm="$warm" \
      -v maxtop="$top_n" -f "$prog" "$prev" "$agg" "$snap"

  sleep 1
done

span=$(( tick > 1 ? tick - 1 : 1 ))

# The same numbers by name, for whoever only wants the verdict. Anything under
# a tenth of a second would print as `0.00 cores, 0 s` and take a slot that a
# real occupant needs.
printf '%s ventanas de ~1s; CPU por nombre de proceso:\n' "$span"
sort -k2,2 -nr "$agg" | awk -v span="$span" 'n < 12 && $2 >= 10 {
  n++
  printf "%-32s %7.2f nucleos medios   %8d s de CPU   pico %5d MB\n", $1, $2 / 100 / span, $2 / 100, $3
}'

exit "$failed"
