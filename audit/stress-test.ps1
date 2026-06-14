# Stress Test — run key capabilities 20 times each
$helper = "C:\Users\arkag\Projects\yomi\apps\uia-helper\bin\Release\net8.0-windows\win-x64\publish\uia-helper.exe"
$reportDir = "C:\Users\arkag\Projects\yomi\audit"

function Invoke-Uia($method, $params = @{}) {
  $req = @{id = [System.Diagnostics.Stopwatch]::GetTimestamp(); method = $method; params = $params } | ConvertTo-Json -Compress
  try { return ($req | & $helper 2>"$env:TEMP\uia-stress-err.log") | ConvertFrom-Json } catch { return $null }
}

function Run-Test($name, $scriptBlock, $iterations = 20) {
  $msg = "Stress testing: $name ($iterations iterations)"
  Write-Output $msg
  $pass = 0; $fail = 0; $times = @(); $failures = @()
  for ($i = 0; $i -lt $iterations; $i++) {
    $start = Get-Date
    try {
      $ok = & $scriptBlock
      $elapsed = ((Get-Date) - $start).TotalMilliseconds
      $times += $elapsed
      if ($ok) { $pass++ } else { $fail++; $failures += "Iteration $($i+1): returned false" }
    } catch {
      $fail++; $failures += "Iteration $($i+1): $($_.Exception.Message)"
    }
  }
  $avg = if ($times.Count -gt 0) { [math]::Round(($times | Measure-Object -Average).Average, 1) } else { 0 }
  $rate = if ($iterations -gt 0) { [math]::Round($pass / $iterations * 100, 1) } else { 0 }
  $resultLine = "  -> Pass: $pass/$iterations ($rate%), Avg: ${avg}ms"
  Write-Output $resultLine
  return @{name = $name; pass = $pass; fail = $fail; total = $iterations; rate = $rate; avgMs = $avg; failures = $failures }
}

function Test-Ping() {
  $r = Invoke-Uia "ping"
  return $r -ne $null -and $r.result.ok
}

function Test-GetForeground() {
  $r = Invoke-Uia "get_foreground"
  $hwnd = if ($r -and $r.result) { $r.result.hwnd } else { 0 }
  return $hwnd -gt 0
}

function Test-MonitorCount() {
  $r = Invoke-Uia "monitor_count"
  $count = if ($r -and $r.result) { $r.result.count } else { 0 }
  return $count -gt 0
}

function Test-FindNotepad() {
  $hwnd = $null
  for ($i = 0; $i -lt 10; $i++) {
    $r = Invoke-Uia "find_window" @{ titleContains = "Notepad" }
    if ($r -and $r.result -and $r.result.hwnd) { $hwnd = $r.result.hwnd; break }
    Start-Sleep -Milliseconds 300
  }
  return $hwnd -ne $null
}

function Test-Screenshot() {
  $r = Invoke-Uia "capture_screen" @{ format = "png" }
  return $r -ne $null -and $r.result -and $r.result.image_b64 -and $r.result.image_b64.length -gt 1000
}

function Test-MediaKey($key) {
  $r = Invoke-Uia "media_key" @{ key = $key }
  return $r -ne $null -and $r.result -and $r.result.ok
}

function Test-GetClipboard() {
  $r = Invoke-Uia "get_clipboard"
  return $r -ne $null -and $r.result -and $r.result.ok
}

function Test-FindSettings() {
  $hwnd = $null
  for ($i = 0; $i -lt 10; $i++) {
    $r = Invoke-Uia "find_window" @{ titleContains = "Settings" }
    if ($r -and $r.result -and $r.result.hwnd) { $hwnd = $r.result.hwnd; break }
    Start-Sleep -Milliseconds 300
  }
  if (-not $hwnd) {
    Start-Process ms-settings:; Start-Sleep -Seconds 3
    for ($i = 0; $i -lt 15; $i++) {
      $r = Invoke-Uia "find_window" @{ titleContains = "Settings" }
      if ($r -and $r.result -and $r.result.hwnd) { $hwnd = $r.result.hwnd; break }
      Start-Sleep -Milliseconds 500
    }
  }
  return $hwnd -ne $null
}

function Test-NotepadLaunch() {
  Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep -Seconds 1
  Start-Process notepad.exe; Start-Sleep -Seconds 2
  $hwnd = $null
  for ($i = 0; $i -lt 10; $i++) {
    $r = Invoke-Uia "find_window" @{ titleContains = "Notepad" }
    if ($r -and $r.result -and $r.result.hwnd) { $hwnd = $r.result.hwnd; break }
    Start-Sleep -Milliseconds 300
  }
  if ($hwnd) { Invoke-Uia "close_window" @{ hwnd = $hwnd }; Start-Sleep -Milliseconds 300 }
  return $hwnd -ne $null
}

function Test-CalculatorLaunch() {
  Get-Process calc, CalculatorApp -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep -Seconds 1
  Start-Process calc.exe; Start-Sleep -Seconds 3
  $hwnd = $null
  for ($i = 0; $i -lt 10; $i++) {
    $r = Invoke-Uia "find_window" @{ titleContains = "Calculator" }
    if (-not ($r -and $r.result.hwnd)) { $r = Invoke-Uia "find_window" @{ process = "CalculatorApp" } }
    if ($r -and $r.result -and $r.result.hwnd) { $hwnd = $r.result.hwnd; break }
    Start-Sleep -Milliseconds 300
  }
  if ($hwnd) { Invoke-Uia "close_window" @{ hwnd = $hwnd }; Start-Sleep -Milliseconds 300 }
  return $hwnd -ne $null
}

function Test-FindChrome() {
  $hwnd = $null
  for ($i = 0; $i -lt 10; $i++) {
    $r = Invoke-Uia "find_window" @{ process = "chrome" }
    if ($r -and $r.result -and $r.result.hwnd) { $hwnd = $r.result.hwnd; break }
    $r = Invoke-Uia "find_window" @{ titleContains = "Google Chrome" }
    if ($r -and $r.result -and $r.result.hwnd) { $hwnd = $r.result.hwnd; break }
    Start-Sleep -Milliseconds 300
  }
  return $hwnd -ne $null
}

function Test-ProcessList() {
  $r = Invoke-Uia "list_processes"
  return $r -ne $null -and $r.result -ne $null -and $r.result.Count -gt 0
}

function Test-ScreenResolution() {
  $r = Invoke-Uia "screen_resolution" @{ monitor = 0 }
  return $r -ne $null -and $r.result -and $r.result.ok -and $r.result.width -gt 0
}

# ===========================================================================
Write-Output "============================================"
Write-Output "STRESS TEST — 20 iterations per capability"
Write-Output "============================================"
Write-Output "Started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Output ""

$tests = @(
  @{name="uia_helper_ping"; fn={ Test-Ping }; iters=20}
  @{name="window_get_foreground"; fn={ Test-GetForeground }; iters=20}
  @{name="screen_monitor_count"; fn={ Test-MonitorCount }; iters=20}
  @{name="screen_resolution"; fn={ Test-ScreenResolution }; iters=20}
  @{name="screen_capture_full"; fn={ Test-Screenshot }; iters=20}
  @{name="clipboard_get"; fn={ Test-GetClipboard }; iters=20}
  @{name="media_play_pause"; fn={ Test-MediaKey "play_pause" }; iters=20}
  @{name="media_next_track"; fn={ Test-MediaKey "next_track" }; iters=20}
  @{name="media_previous_track"; fn={ Test-MediaKey "prev_track" }; iters=20}
  @{name="process_list"; fn={ Test-ProcessList }; iters=20}
  @{name="app_find_settings"; fn={ Test-FindSettings }; iters=20}
  @{name="app_find_chrome"; fn={ Test-FindChrome }; iters=20}
  @{name="app_launch_notepad"; fn={ Test-NotepadLaunch }; iters=5}
  @{name="app_launch_calculator"; fn={ Test-CalculatorLaunch }; iters=5}
)

$results = @()
foreach ($test in $tests) {
  $iters = if ($test.ContainsKey('iters')) { $test.iters } else { 20 }
  $results += Run-Test $test.name $test.fn $iters
}

Write-Output ""
Write-Output "============================================"
Write-Output "STRESS TEST RESULTS"
Write-Output "============================================"

$certified = @()
$degraded = @()
$failing = @()

foreach ($r in $results) {
  $status = if ($r.rate -ge 95) { "CERTIFIED" } elseif ($r.rate -gt 0) { "DEGRADED" } else { "FAILING" }
  if ($status -eq "CERTIFIED") { $certified += $r.name }
  elseif ($status -eq "DEGRADED") { $degraded += $r.name }
  else { $failing += $r.name }

  Write-Output "[$status] $($r.name): $($r.pass)/$($r.total) — $($r.rate)% — avg ${($r.avgMs)}ms"
  if ($r.failures.Count -gt 0) {
    foreach ($f in $r.failures[0..2]) { Write-Output "  → $f" }
  }
}

Write-Output ""
Write-Output "Certified ($($certified.Count)): $($certified -join ', ')"
Write-Output "Degraded ($($degraded.Count)): $($degraded -join ', ')"
Write-Output "Failing ($($failing.Count)): $($failing -join ', ')"

# Save report
$report = @"
# Stress Test Report
Generated: $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')
## Results
$(foreach ($r in $results) {
@"
### $($r.name)
- Pass: $($r.pass)/$($r.total) ($($r.rate)%)
- Avg time: $($r.avgMs)ms
- Status: $(if($r.rate -ge 95){'CERTIFIED'}elseif($r.rate -gt 0){'DEGRADED'}else{'FAILING'})
$(if($r.failures.Count -gt 0){ "Failures: $($r.failures -join '; ')" }else{ "Failures: none" })
"@
})
## Summary
- Certified: $($certified.Count)
- Degraded: $($degraded.Count)
- Failing: $($failing.Count)
"@
$report | Set-Content "$reportDir\stress_test_report.md"
Write-Output "`nReport saved to $reportDir\stress_test_report.md"
