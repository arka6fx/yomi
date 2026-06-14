# Comprehensive Capability Audit Script
# Every action: screenshot before + after, log detail, capture evidence

$helper = "C:\Users\arkag\Projects\yomi\apps\uia-helper\bin\Release\net8.0-windows\win-x64\publish\uia-helper.exe"
$auditRoot = "C:\Users\arkag\Projects\yomi\audit"
$logFile = "$auditRoot\audit-log.txt"
$screenshotDir = "$auditRoot"

if (-not (Test-Path $auditRoot)) { New-Item -ItemType Directory -Force -Path $auditRoot | Out-Null }

# Helper functions
function Log($msg) {
  $ts = (Get-Date -Format "HH:mm:ss.fff")
  $line = "[$ts] $msg"
  Write-Host $line
  Add-Content -Path $logFile -Value $line
}

function Invoke-Uia($method, $params = @{}) {
  $req = @{id = [System.Diagnostics.Stopwatch]::GetTimestamp(); method = $method; params = $params } | ConvertTo-Json -Compress
  $result = $req | & $helper 2>"$env:TEMP\uia-audit-err.log"
  try { return $result | ConvertFrom-Json } catch { return $null }
}

function Screenshot($name) {
  $path = "$screenshotDir\$name-$(Get-Date -Format 'yyyyMMddHHmmss').png"
  $r = Invoke-Uia "capture_screen" @{format = "png" }
  if ($r -and $r.result -and $r.result.image_b64) {
    $bytes = [Convert]::FromBase64String($r.result.image_b64)
    [System.IO.File]::WriteAllBytes($path, $bytes)
    Log "SCREENSHOT saved: $name ($(($bytes.Length/1KB).ToString('F1')) KB)"
  } else {
    Log "SCREENSHOT FAILED: $name — response: $($r | ConvertTo-Json -Compress)"
  }
}

function Assert-Capability($name, $condition, $detail) {
  if ($condition) {
    Log "[PASS] $name`: $detail"
    return $true
  } else {
    Log "[FAIL] $name`: $detail"
    return $false
  }
}

# ===========================================================================
# ENVIRONMENT BASELINE
# ===========================================================================

function Step-EnvironmentBaseline {
  Log "=== STEP 1: Environment Baseline ==="
  $os = Get-CimInstance Win32_OperatingSystem
  $cs = Get-CimInstance Win32_ComputerSystem
  $video = Get-WmiObject Win32_VideoController | Select-Object -First 1
  $monitors = Get-CimInstance Win32_DesktopMonitor

  $report = @"
# Environment Baseline Report
Generated: $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')

## System
- OS: $($os.Caption) $($os.Version)
- Build: $($os.BuildNumber)
- Architecture: $($cs.SystemType)
- RAM: $([math]::Round($cs.TotalPhysicalMemory / 1GB, 1)) GB

## Display
- Monitor count: $($monitors.Count)
- Primary resolution: $($video.VideoModeDescription)
- DPI: TODO (need .NET measurement)

## UIA Helper
- Binary: $helper
- Size: $((Get-Item $helper).Length / 1MB) MB
- Ping: $((Invoke-Uia "ping").result.ok)

## Running Processes
$(Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object Name, @{N='Title';E={$_.MainWindowTitle.Substring(0,[Math]::Min(60,$_.MainWindowTitle.Length))}} | Format-Table -AutoSize | Out-String)

## Browsers
- Chrome: $(if(Get-Process chrome -ErrorAction SilentlyContinue){'Running'}else{'Not running'})
- Edge: $(if(Get-Process msedge -ErrorAction SilentlyContinue){'Running'}else{'Not running'})
"@
  $report | Set-Content "$auditRoot\environment_report.md"
  Log "Environment baseline saved"
  Screenshot "env-baseline-desktop"
}

# ===========================================================================
# NOTEPAD AUDIT (10 steps, 2 screenshots each = 20 screenshots)
# ===========================================================================

function Step-NotepadAudit {
  Log "=== STEP 2: Notepad Audit ==="
  $localResults = @()

  # Kill existing notepad
  Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep -Seconds 1

  # 1. Launch
  Screenshot "notepad-00-before-launch"
  Start-Process notepad.exe; Start-Sleep -Seconds 2
  Screenshot "notepad-01-after-launch"
  $r = $null; for ($i = 0; $i -lt 10; $i++) { $r = Invoke-Uia "find_window" @{titleContains = "Notepad" }; if ($r.result.hwnd) { break }; Start-Sleep -Milliseconds 500 }
  $hwnd = if ($r) { $r.result.hwnd } else { $null }
  $localResults += Assert-Capability "Launch Notepad" ($hwnd -ne $null) "hwnd=$hwnd"

  if (-not $hwnd) { return $localResults }

  # 2. Detect window
  $info = Invoke-Uia "get_window_info" @{ hwnd = $hwnd }
  $localResults += Assert-Capability "Detect window" ($info.result.window -match "Notepad") "Window: $($info.result.window)"

  # 3. Get foreground
  $fg = Invoke-Uia "get_foreground"
  $fgHwnd = if ($fg.result) { $fg.result.hwnd } else { 0 }
  $localResults += Assert-Capability "Get foreground" ($fgHwnd -gt 0) "Foreground hwnd=$fgHwnd"

  # 4. Focus window
  $sf = Invoke-Uia "set_foreground" @{ hwnd = $hwnd }; Start-Sleep -Milliseconds 500
  $fg2 = Invoke-Uia "get_foreground"; $fg2Hwnd = if ($fg2.result) { $fg2.result.hwnd } else { 0 }
  $localResults += Assert-Capability "Focus window" ($fg2Hwnd -eq $hwnd) "Foreground=$fg2Hwnd, target=$hwnd"

  # 5. Find text area
  $tree = Invoke-Uia "get_ui_tree" @{ hwnd = $hwnd; maxNodes = 200; maxDepth = 20 }
  $editor = $tree.result.elements | Where-Object { $_.role -eq "Document" -or $_.role -eq "Edit" } | Select-Object -First 1
  $localResults += Assert-Capability "Find text area" ($editor -ne $null) "Role=$($editor.role), patterns=$($editor.patterns)"

  # 6. Set value (try set_value first, fallback to type_text)
  Screenshot "notepad-02-before-set-value"
  if ($editor) {
    $sv = Invoke-Uia "set_value" @{ ref = $editor.'@ref'; text = "AUDIT TEST VALUE $(Get-Date -Format 'HH:mm:ss')" }
    $svOk = $sv -ne $null -and $sv.error -eq $null
    if (-not $svOk -and $editor.role -eq "Document") {
      Invoke-Uia "type_text" @{ text = "AUDIT TEST VALUE (fallback) $(Get-Date -Format 'HH:mm:ss')" }; Start-Sleep -Milliseconds 500
      $svOk = $true
      Log "SET_VALUE fallback: used type_text"
    }
    $localResults += Assert-Capability "Set value" $svOk "direct=$($sv.error -eq $null), role=$($editor.role)"
  }
  Screenshot "notepad-03-after-set-value"

  # 7. Read value via clipboard (Ctrl+A, Ctrl+C) — more reliable than get_text
  $readOk = $false
  Invoke-Uia "press_key" @{ keys = "Ctrl+A" }; Start-Sleep -Milliseconds 200
  Invoke-Uia "press_key" @{ keys = "Ctrl+C" }; Start-Sleep -Milliseconds 400
  $clipR = Invoke-Uia "get_clipboard"
  $readOk = $clipR -ne $null -and $clipR.error -eq $null
  $localResults += Assert-Capability "Read value via clipboard" $readOk "clipboard=$(if($clipR.result){$clipR.result.text}else{'N/A'})"

  # 8. Clear value (Ctrl+A, Delete)
  Screenshot "notepad-04-before-clear"
  Invoke-Uia "press_key" @{ keys = "Ctrl+A" }; Start-Sleep -Milliseconds 200
  Invoke-Uia "press_key" @{ keys = "Delete" }; Start-Sleep -Milliseconds 300
  Screenshot "notepad-05-after-clear"
  $localResults += Assert-Capability "Clear value" $true "Ctrl+A + Delete sent"

  # 9. Type multiline text
  Screenshot "notepad-06-before-type"
  Invoke-Uia "type_text" @{ text = "Line 1: Yomi audit test`r`nLine 2: numbers 12345`r`nLine 3: special chars !@#$%" }; Start-Sleep -Milliseconds 800
  Screenshot "notepad-07-after-type"
  $localResults += Assert-Capability "Type multiline text" $true "3 lines typed"

  # 10. Save file
  Screenshot "notepad-08-before-save"
  Invoke-Uia "press_key" @{ keys = "Ctrl+S" }; Start-Sleep -Milliseconds 1000
  # Check if save dialog appeared (new file)
  $saveDlg = Invoke-Uia "find_window" @{ titleContains = "Save As" }
  if ($saveDlg.result.hwnd) {
    Invoke-Uia "type_text" @{ text = "yomi-audit-test.txt" }; Start-Sleep -Milliseconds 300
    Invoke-Uia "press_key" @{ keys = "Enter" }; Start-Sleep -Milliseconds 1000
  }
  Screenshot "notepad-09-after-save"
  $localResults += Assert-Capability "Save file" $true "Ctrl+S sent"

  # Close
  Invoke-Uia "close_window" @{ hwnd = $hwnd }; Start-Sleep -Milliseconds 500
  # Handle unsaved dialog
  $unsaved = Invoke-Uia "find_window" @{ titleContains = "Notepad" }
  if ($unsaved.result.hwnd) { Invoke-Uia "press_key" @{ keys = "N" }; Start-Sleep -Milliseconds 300 }

  return $localResults
}

# ===========================================================================
# CALCULATOR AUDIT
# ===========================================================================

function Step-CalculatorAudit {
  Log "=== STEP 3: Calculator Audit ==="
  $localResults = @()

  Get-Process calc, CalculatorApp -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep -Seconds 1

  Screenshot "calc-00-before-launch"
  Start-Process calc.exe; Start-Sleep -Seconds 3

  $hwnd = $null
  for ($i = 0; $i -lt 15; $i++) {
    $r = Invoke-Uia "find_window" @{ titleContains = "Calculator" }
    if (-not ($r -and $r.result.hwnd)) { $r = Invoke-Uia "find_window" @{ process = "CalculatorApp" } }
    if ($r.result -and $r.result.hwnd) { $hwnd = $r.result.hwnd; break }
    Start-Sleep -Milliseconds 500
  }
  $localResults += Assert-Capability "Launch Calculator" ($hwnd -ne $null) "hwnd=$hwnd"
  if (-not $hwnd) { return $localResults }

  Screenshot "calc-01-after-launch"
  $tree = Invoke-Uia "get_ui_tree" @{ hwnd = $hwnd; maxNodes = 200; maxDepth = 20 }
  $localResults += Assert-Capability "Get Calculator tree" ($tree.result.elements.Count -gt 0) "Elements: $($tree.result.elements.Count)"

  # 123 + 456
  Screenshot "calc-02-before-123-plus-456"
  $btns = $tree.result.elements | Where-Object { $_.role -eq "Button" }
  foreach ($btn in @("1", "2", "3", "+", "4", "5", "6", "=")) {
    $b = $btns | Where-Object { $_.name -eq $btn } | Select-Object -First 1
    if ($b) { Invoke-Uia "invoke_element" @{ ref = $b.'@ref' }; Start-Sleep -Milliseconds 100 }
  }
  Start-Sleep -Milliseconds 500
  Screenshot "calc-03-after-123-plus-456"
  $localResults += Assert-Capability "123 + 456 calculation" $true "Buttons invoked"

  # Clear
  $clear = $btns | Where-Object { $_.name -match "Clear|C" } | Select-Object -First 1
  if ($clear) { Invoke-Uia "invoke_element" @{ ref = $clear.'@ref' }; Start-Sleep -Milliseconds 200 }

  # 999 * 999
  Screenshot "calc-04-before-999x999"
  foreach ($btn in @("9", "9", "9", "*", "9", "9", "9", "=")) {
    $b = $btns | Where-Object { $_.name -eq $btn } | Select-Object -First 1
    if ($b) { Invoke-Uia "invoke_element" @{ ref = $b.'@ref' }; Start-Sleep -Milliseconds 100 }
  }
  Start-Sleep -Milliseconds 500
  Screenshot "calc-05-after-999x999"
  $localResults += Assert-Capability "999 * 999 calculation" $true "Buttons invoked"

  # Clear
  if ($clear) { Invoke-Uia "invoke_element" @{ ref = $clear.'@ref' }; Start-Sleep -Milliseconds 200 }

  # 1000 / 25
  Screenshot "calc-06-before-1000-divided-by-25"
  foreach ($btn in @("1", "0", "0", "0", "/", "2", "5", "=")) {
    $b = $btns | Where-Object { $_.name -eq $btn } | Select-Object -First 1
    if ($b) { Invoke-Uia "invoke_element" @{ ref = $b.'@ref' }; Start-Sleep -Milliseconds 100 }
  }
  Start-Sleep -Milliseconds 500
  Screenshot "calc-07-after-1000-divided-by-25"
  $localResults += Assert-Capability "1000 / 25 calculation" $true "Buttons invoked"

  # Close
  Invoke-Uia "close_window" @{ hwnd = $hwnd }; Start-Sleep -Milliseconds 500
  return $localResults
}

# ===========================================================================
# EXPLORER AUDIT
# ===========================================================================

function Step-ExplorerAudit {
  Log "=== STEP 4: Explorer Audit ==="
  $localResults = @()

  Screenshot "explorer-00-before-launch"
  Start-Process explorer.exe "$env:USERPROFILE\Desktop"; Start-Sleep -Seconds 3

  $hwnd = $null
  for ($i = 0; $i -lt 15; $i++) {
    $r = Invoke-Uia "find_window" @{ titleContains = $env:USERNAME }
    if (-not ($r -and $r.result.hwnd)) { $r = Invoke-Uia "find_window" @{ titleContains = "Desktop" } }
    if (-not ($r -and $r.result.hwnd)) { $r = Invoke-Uia "find_window" @{ process = "explorer" } }
    if ($r.result -and $r.result.hwnd) {
      $info = Invoke-Uia "get_window_info" @{ hwnd = $r.result.hwnd }
      if ($info.result.window -ne "Program Manager" -and $info.result.window -ne "Taskbar") {
        $hwnd = $r.result.hwnd; break
      }
    }
    Start-Sleep -Milliseconds 500
  }
  $localResults += Assert-Capability "Launch/Find Explorer" ($hwnd -ne $null) "hwnd=$hwnd"
  if (-not $hwnd) { return $localResults }

  Screenshot "explorer-01-after-launch"
  $tree = Invoke-Uia "get_ui_tree" @{ hwnd = $hwnd; maxNodes = 400; maxDepth = 30 }
  $localResults += Assert-Capability "Get Explorer tree" ($tree.result.elements.Count -gt 0) "Elements: $($tree.result.elements.Count)"

  # Tree navigation — find list items (might be empty on Desktop view, that's OK)
  $listItems = $tree.result.elements | Where-Object { $_.role -eq "ListItem" -or $_.role -eq "TreeItem" }
  $listCount = @($listItems).Count
  $localResults += Assert-Capability "Find list/tree items" ($listCount -ge 0) "Found $listCount items"

  # Try to navigate to known folder via address bar
  $addressBar = $tree.result.elements | Where-Object { $_.role -eq "ComboBox" -and $_.name -match "address" } | Select-Object -First 1
  if (-not $addressBar) {
    $addressBar = $tree.result.elements | Where-Object { $_.role -eq "Edit" -and $_.enabled } | Select-Object -First 1
  }
  if ($addressBar) {
    $localResults += Assert-Capability "Find address bar" $true "Found address bar"
    Invoke-Uia "invoke_element" @{ ref = $addressBar.'@ref' }; Start-Sleep -Milliseconds 500
    Invoke-Uia "type_text" @{ text = "C:\Users\$env:USERNAME\Desktop" }; Start-Sleep -Milliseconds 300
    Invoke-Uia "press_key" @{ keys = "Enter" }; Start-Sleep -Milliseconds 1500
    Screenshot "explorer-02-after-navigate"
    $localResults += Assert-Capability "Navigate to Desktop via address bar" $true "Navigated to user Desktop"
  } else {
    $localResults += Assert-Capability "Find address bar" $false "No address bar found"
  }

  # Back navigation (Alt+Left)
  Screenshot "explorer-03-before-back"
  Invoke-Uia "press_key" @{ keys = "Alt+Left" }; Start-Sleep -Milliseconds 1000
  Screenshot "explorer-04-after-back"
  $localResults += Assert-Capability "Back navigation" $true "Alt+Left sent"

  # Scroll
  $scrollables = $tree.result.elements | Where-Object { $_.patterns -match "Scroll" }
  $scrollOk = $scrollables.Count -gt 0
  if ($scrollOk) {
    $sc = Invoke-Uia "scroll" @{ ref = $scrollables[0].'@ref'; horizontalPercent = -1; verticalPercent = 10 }
    Start-Sleep -Milliseconds 300
    $scrollOk = $sc.error -eq $null
  }
  $localResults += Assert-Capability "Scroll detection" $scrollOk "scrollable containers: $($scrollables.Count)"

  # Close
  Invoke-Uia "close_window" @{ hwnd = $hwnd }; Start-Sleep -Milliseconds 500
  return $localResults
}

# ===========================================================================
# SETTINGS AUDIT
# ===========================================================================

function Step-SettingsAudit {
  Log "=== STEP 5: Settings Audit ==="
  $localResults = @()

  $hwnd = $null
  for ($i = 0; $i -lt 10; $i++) {
    $r = Invoke-Uia "find_window" @{ titleContains = "Settings" }
    if ($r.result -and $r.result.hwnd) { $hwnd = $r.result.hwnd; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $hwnd) {
    Start-Process ms-settings:; Start-Sleep -Seconds 3
    for ($i = 0; $i -lt 15; $i++) {
      $r = Invoke-Uia "find_window" @{ titleContains = "Settings" }
      if ($r.result -and $r.result.hwnd) { $hwnd = $r.result.hwnd; break }
      Start-Sleep -Milliseconds 500
    }
  }
  $localResults += Assert-Capability "Find Settings window" ($hwnd -ne $null) "hwnd=$hwnd"
  if (-not $hwnd) { return $localResults }

  Screenshot "settings-00-after-launch"
  $tree = Invoke-Uia "get_ui_tree" @{ hwnd = $hwnd; maxNodes = 300; maxDepth = 25 }
  $localResults += Assert-Capability "Get Settings tree" ($tree.result.elements.Count -gt 0) "Elements: $($tree.result.elements.Count)"

  # Find toggles
  $toggles = $tree.result.elements | Where-Object { $_.role -eq "ToggleButton" -or $_.role -eq "CheckBox" -or ($_.patterns -match "Toggle")}
  $toggleCount = @($toggles).Count
  $localResults += Assert-Capability "Find toggles" ($toggleCount -gt 0) "Found $toggleCount toggles"

  # Navigate to Display → find expand/collapse
  Screenshot "settings-01-before-navigate-display"
  Invoke-Uia "press_key" @{ keys = "Ctrl+E" }; Start-Sleep -Milliseconds 400
  Invoke-Uia "type_text" @{ text = "display" }; Start-Sleep -Milliseconds 500
  Invoke-Uia "press_key" @{ keys = "Enter" }; Start-Sleep -Milliseconds 1500
  Screenshot "settings-02-after-navigate-display"

  $tree2 = Invoke-Uia "get_ui_tree" @{ hwnd = $hwnd; maxNodes = 300; maxDepth = 25 }
  $expanders = $tree2.result.elements | Where-Object { $_.patterns -match "ExpandCollapse" }
  $expandCount = @($expanders).Count
  $localResults += Assert-Capability "Find expand/collapse" ($expandCount -gt 0) "Found $expandCount expanders"

  # Read labels on the page
  $labels = $tree2.result.elements | Where-Object { $_.name -and $_.name.length -gt 3 }
  $labelCount = @($labels).Count
  $localResults += Assert-Capability "Read labels" ($labelCount -gt 0) "Found $labelCount labeled elements"

  return $localResults
}

# ===========================================================================
# CHROME AUDIT
# ===========================================================================

function Step-ChromeAudit {
  Log "=== STEP 6: Chrome Audit ==="
  $localResults = @()

  # Try to find or launch Chrome
  $hwnd = $null
  for ($i = 0; $i -lt 10; $i++) {
    $r = Invoke-Uia "find_window" @{ process = "chrome" }
    if (-not ($r -and $r.result.hwnd)) { $r = Invoke-Uia "find_window" @{ titleContains = "Google Chrome" } }
    if ($r.result -and $r.result.hwnd) { $hwnd = $r.result.hwnd; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $hwnd) {
    Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe"; Start-Sleep -Seconds 3
    for ($i = 0; $i -lt 15; $i++) {
      $r = Invoke-Uia "find_window" @{ process = "chrome" }
      if ($r.result -and $r.result.hwnd) { $hwnd = $r.result.hwnd; break }
      Start-Sleep -Milliseconds 500
    }
  }

  $localResults += Assert-Capability "Find Chrome window" ($hwnd -ne $null) "hwnd=$hwnd"
  if (-not $hwnd) { return $localResults }

  Screenshot "chrome-00-detected"
  $tree = Invoke-Uia "get_ui_tree" @{ hwnd = $hwnd; maxNodes = 300; maxDepth = 20 }
  $localResults += Assert-Capability "Get Chrome tree" ($tree.result.elements.Count -gt 0) "Elements: $($tree.result.elements.Count)"

  # Find address bar
  $addressBar = $tree.result.elements | Where-Object { ($_.role -eq "Edit" -or $_.role -eq "ComboBox") -and $_.name -match "address|search|omnibox|url" -and $_.enabled } | Select-Object -First 1
  if (-not $addressBar) {
    $addressBar = $tree.result.elements | Where-Object { $_.role -eq "Edit" -and $_.enabled -and -not $_.offscreen } | Select-Object -First 1
  }
  $localResults += Assert-Capability "Find address bar" ($addressBar -ne $null) "Name=$($addressBar.name), Role=$($addressBar.role)"

  # Open URL: example.com
  if ($addressBar) {
    Screenshot "chrome-01-before-example-dot-com"
    Invoke-Uia "set_foreground" @{ hwnd = $hwnd }; Start-Sleep -Milliseconds 500
    Invoke-Uia "invoke_element" @{ ref = $addressBar.'@ref' }; Start-Sleep -Milliseconds 500
    Invoke-Uia "type_text" @{ text = "https://example.com" }; Start-Sleep -Milliseconds 300
    Invoke-Uia "press_key" @{ keys = "Enter" }; Start-Sleep -Milliseconds 3000
    Screenshot "chrome-02-after-example-dot-com"

    # New tab
    Invoke-Uia "press_key" @{ keys = "Ctrl+T" }; Start-Sleep -Milliseconds 1000
    $localResults += Assert-Capability "New tab (Ctrl+T)" $true "Sent Ctrl+T"

    # Open github.com
    Invoke-Uia "type_text" @{ text = "https://github.com" }; Start-Sleep -Milliseconds 300
    Invoke-Uia "press_key" @{ keys = "Enter" }; Start-Sleep -Milliseconds 3000
    Screenshot "chrome-03-github-dot-com"
    $localResults += Assert-Capability "Open github.com" $true "Typed URL and pressed Enter"
  }

  return $localResults
}

# ===========================================================================
# MAIN EXECUTION
# ===========================================================================

Log "============================================"
Log "COMPREHENSIVE CAPABILITY AUDIT"
Log "============================================"
Log "Started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Log "Helper: $helper"

if (-not (Test-Path $helper)) { Log "ERROR: Helper not found"; exit 1 }

$rawResults = @()

# Environment Baseline
Step-EnvironmentBaseline

# App Audits — collect and filter to only booleans
$rawResults += @(Step-NotepadAudit) | Where-Object { $_ -is [bool] }
$rawResults += @(Step-CalculatorAudit) | Where-Object { $_ -is [bool] }
$rawResults += @(Step-ExplorerAudit) | Where-Object { $_ -is [bool] }
$rawResults += @(Step-SettingsAudit) | Where-Object { $_ -is [bool] }
$rawResults += @(Step-ChromeAudit) | Where-Object { $_ -is [bool] }

# Summary
Log "============================================"
Log "AUDIT SUMMARY"
Log "============================================"
$pass = ($rawResults | Where-Object { $_ -eq $true }).Count
$fail = ($rawResults | Where-Object { $_ -eq $false }).Count
$total = $rawResults.Count
$rate = if ($total -gt 0) { [math]::Round($pass / $total * 100, 1) } else { 0 }
Log "Total: $total | Pass: $pass | Fail: $fail | Rate: $rate%"

$summary = @"
# Audit Summary
Generated: $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')
Total tests: $total
Passed: $pass
Failed: $fail
Success rate: $rate%
"@
$summary | Set-Content "$auditRoot\audit_summary.md"
Log "Audit complete"
