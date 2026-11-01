# Samples every process on the box once a second and writes who burned CPU, by
# name, to a CSV. It exists because a worker that goes quiet for thirty seconds
# left no evidence behind twice already: by the time anyone asked, the process
# that took the cores was gone and its pid meant nothing.
#
# CPU is recorded as the delta in centiseconds against the previous tick, so a
# process that exits keeps its name in the row where it worked. Summing
# cumulative times over a changing set of processes is not monotonic -- a worker
# exiting makes the total go backwards -- which is why this keeps the previous
# snapshot itself instead of leaving that to whoever reads the file.
#
#   powershell -NoProfile -File scripts/cpu-sampler.ps1 -Seconds 700 -Out out.log
#
# The note at the end of .githooks/pre-push says the same thing where a red push
# is actually read: how to pair this with the suite and read the verdict.
#
# The CSV columns are: ts, freeMb, totalCs, top. `top` holds up to fifteen
# `name=pid=cs=wsMb` entries, the busiest first; anything quieter than that in a
# given second is in totalCs but unnamed, which is the right trade for a file
# that would otherwise be megabytes of noise.
param(
  [int]$Seconds = 700,
  [string]$Out = 'cpu-samples.log',
  [int]$FreeEvery = 5,
  [int]$Top = 15
)

$deadline = (Get-Date).AddSeconds($Seconds)
try { Remove-Item $Out -ErrorAction SilentlyContinue } catch { }
'ts,freeMb,totalCs,top' | Out-File -FilePath $Out -Encoding utf8

$prev = @{}
$byName = @{}
$tick = 0
$freeMb = ''
$warmed = $false

while ((Get-Date) -lt $deadline) {
  if ($FreeEvery -gt 0 -and $tick % $FreeEvery -eq 0) {
    try { $freeMb = [int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1KB) } catch { }
  }
  $tick++

  $entries = New-Object System.Collections.ArrayList
  $totalCs = 0
  $snapshot = @(Get-Process -ErrorAction SilentlyContinue)

  # The first pass only fills the previous snapshot. Without it every process is
  # new on tick one and its whole lifetime goes into the first window: explorer
  # alone claimed 10,641 s of CPU in that version.
  if (-not $warmed) {
    foreach ($p in $snapshot) {
      try { $prev[$p.Id] = [int]($p.TotalProcessorTime.TotalMilliseconds / 10) } catch { }
    }
    $warmed = $true
    Start-Sleep -Milliseconds 500
    continue
  }

  foreach ($p in $snapshot) {
    $cs = $null
    try { $cs = [int]($p.TotalProcessorTime.TotalMilliseconds / 10) } catch { continue }
    $was = $prev[$p.Id]
    # A pid missing from the previous tick is new, so all of its time was spent
    # in this window; anything negative is a reused pid and is taken as new too.
    $delta = if ($was -ne $null -and $cs -ge $was) { $cs - $was } else { $cs }
    $prev[$p.Id] = $cs
    if ($delta -le 0) { continue }

    $totalCs += $delta
    $name = $p.Name
    if (-not $byName.ContainsKey($name)) { $byName[$name] = @{ Cs = 0; PeakWs = 0 } }
    $byName[$name].Cs += $delta
    $wsMb = [int]($p.WorkingSet64 / 1MB)
    if ($wsMb -gt $byName[$name].PeakWs) { $byName[$name].PeakWs = $wsMb }
    [void]$entries.Add([pscustomobject]@{ Name = $name; Id = $p.Id; Cs = $delta; WsMb = $wsMb })
  }

  $parts = $entries |
    Sort-Object Cs -Descending |
    Select-Object -First $Top |
    ForEach-Object { '{0}={1}={2}={3}' -f $_.Name, $_.Id, $_.Cs, $_.WsMb }

  # Invariant culture on purpose: this box writes decimals with a comma, which
  # would split a row when a value is ever fractional.
  [System.String]::Format(
    [System.Globalization.CultureInfo]::InvariantCulture, '{0},{1},{2},{3}',
    (Get-Date -Format 'HH:mm:ss'), $freeMb, $totalCs, ($parts -join ';')) |
    Out-File -FilePath $Out -Append -Encoding utf8

  Start-Sleep -Milliseconds 1000
}

# The same numbers by name, for whoever only wants the verdict. Invariant
# culture again, since the rest of this script would print 1.330,15 otherwise.
$span = [math]::Max(1, $tick - 1)
[System.String]::Format([System.Globalization.CultureInfo]::InvariantCulture,
  '{0} ventanas de ~1s; CPU por nombre de proceso:', $span)
foreach ($entry in ($byName.GetEnumerator() | Sort-Object { $_.Value.Cs } -Descending | Select-Object -First 12)) {
  [System.String]::Format([System.Globalization.CultureInfo]::InvariantCulture,
    '{0,-32} {1,7:N2} nucleos medios   {2,8:N0} s de CPU   pico {3,5:N0} MB',
    $entry.Key, ($entry.Value.Cs / 100 / $span), ($entry.Value.Cs / 100), $entry.Value.PeakWs)
}
