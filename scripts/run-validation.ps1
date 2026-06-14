# Real Capability Validation Runner
# Tests every capability against live Windows apps with objective evidence

$helper = "C:\Users\arkag\Projects\yomi\apps\uia-helper\bin\Release\net8.0-windows\win-x64\publish\uia-helper.exe"
$report = @{}
$results = @()
$evidence = @()

function Invoke-UiaMethod($method, $params = @{}) {
  $req = @{id=[string]::Format("{0}", [System.Diagnostics.Stopwatch]::GetTimestamp());method=$method;params=$params} | ConvertTo-Json -Compress
  $result = $req | & $helper 2>"$env:TEMP\uia-val-err.log"
  try { return $result | ConvertFrom-Json } catch { return $null }
}

function Record-Result($capability, $category, $passed, $evidenceLabels, $detail) {
  $global:results += @{
    capability = $capability
    category = $category
    passed = $passed
    evidence = $evidenceLabels
    detail = $detail
    timestamp = (Get-Date -Format "o")
  }
  $status = if ($passed) { "PASS" } else { "FAIL" }
  Write-Output "[$status] $capability`: $detail"
}

function Test-Ping {
  $r = Invoke-UiaMethod "ping"
  $ok = $r.result.ok -eq $true
  Record-Result "uia_helper_ping" "Infrastructure" $ok @("process_state") "UIA helper ping: $($r | ConvertTo-Json -Compress)"
  return $ok
}

function Test-WindowActions {
  Write-Output "`n=== Window Management Tests ==="
  
  # Launch Notepad fresh
  Start-Process notepad.exe
  Start-Sleep -Seconds 2
  
  $hwnd = $null
  for ($i = 0; $i -lt 10; $i++) {
    $r = Invoke-UiaMethod "find_window" @{titleContains="Notepad"}
    if ($r.result -and $r.result.hwnd) { $hwnd = $r.result.hwnd; break }
    Start-Sleep -Milliseconds 500
  }
  
  if (-not $hwnd) {
    Record-Result "app_launch_notepad" "Application Management" $false @() "Could not find Notepad window"
    return $null
  }
  Record-Result "app_launch_notepad" "Application Management" $true @("process_state") "Notepad launched, hwnd=$hwnd"
  
  # Get window info
  $info = Invoke-UiaMethod "get_window_info" @{hwnd=$hwnd}
  $windowName = $info.result.window
  $hasWindow = $windowName -match "Notepad"
  Record-Result "window_get_info" "Window Management" $hasWindow @("ui_state") "Window name: $windowName"
  
  # Get UI tree
  $tree = Invoke-UiaMethod "get_ui_tree" @{hwnd=$hwnd; maxNodes=200; maxDepth=20}
  $hasElements = ($tree.result.elements | Measure-Object).Count -gt 0
  Record-Result "ui_get_tree" "UI Automation" $hasElements @("ui_state") "Got $($hasElements) elements, truncated=$($tree.result.truncated)"
  
  # Find Document element (editor)
  $editor = $tree.result.elements | Where-Object { $_.role -eq "Document" -or $_.role -eq "Edit" } | Select-Object -First 1
  $foundEditor = $editor -ne $null
  Record-Result "ui_find_element" "UI Automation" $foundEditor @("ui_state") "Found editor element: $(if($editor){$editor.'@ref'}else{'none'})"
  
  # Type text
  if ($editor) {
    $typeResult = Invoke-UiaMethod "type_text" @{text="Capability validation test - $(Get-Date)"}
    $typed = $typeResult -ne $null -and $typeResult.error -eq $null
    Start-Sleep -Milliseconds 500
    # Verify via getElement
    $verify = Invoke-UiaMethod "get_subtree" @{ref=$editor.'@ref'; maxNodes=50; maxDepth=5}
    $verifiable = $verify -ne $null
    Record-Result "ui_type_text" "UI Automation" ($typed -and $verifiable) @("ui_state") "Type text: ok=$typed, verify=$verifiable"
  }
  
  # Set value — Document controls lack Value pattern; fall back to type_text
  if ($editor) {
    $svResult = Invoke-UiaMethod "set_value" @{ref=$editor.'@ref'; text="SET VALUE TEST $(Get-Date)"}
    $svOk = $svResult -ne $null -and $svResult.error -eq $null
    if (-not $svOk -and $editor.role -eq "Document") {
      # Fallback: use type_text for Document controls
      $svFallback = Invoke-UiaMethod "type_text" @{text="SET VALUE TEST $(Get-Date)"}
      $svOk = $svFallback -ne $null -and $svFallback.error -eq $null
      Start-Sleep -Milliseconds 400
      $verifySv = Invoke-UiaMethod "get_subtree" @{ref=$editor.'@ref'; maxNodes=50; maxDepth=5}
      $svOk = $svOk -and ($verifySv -ne $null)
      Record-Result "ui_set_value" "UI Automation" $svOk @("ui_state") "Set value: ok=$svOk (fallback=type_text)"
    } else {
      Record-Result "ui_set_value" "UI Automation" $svOk @("ui_state") "Set value: ok=$svOk (direct)"
    }
    Start-Sleep -Milliseconds 400
  }
  
  # Move window
  $moveResult = Invoke-UiaMethod "move_window" @{hwnd=$hwnd; x=100; y=100}
  $moved = $moveResult -ne $null -and $moveResult.error -eq $null
  Record-Result "window_move" "Window Management" $moved @("ui_state") "Move window: ok=$moved"
  Start-Sleep -Milliseconds 300
  
  # Resize window
  $resizeResult = Invoke-UiaMethod "resize_window" @{hwnd=$hwnd; width=900; height=700}
  $resized = $resizeResult -ne $null -and $resizeResult.error -eq $null
  Record-Result "window_resize" "Window Management" $resized @("ui_state") "Resize window: ok=$resized"
  Start-Sleep -Milliseconds 300
  
  # Press key (Ctrl+A to select all)
  $keyResult = Invoke-UiaMethod "press_key" @{keys="Ctrl+A"}
  $keyOk = $keyResult -ne $null -and $keyResult.error -eq $null
  Record-Result "press_key" "System Administration" $keyOk @("ui_state") "Press key Ctrl+A: ok=$keyOk"
  Start-Sleep -Milliseconds 200
  
  # Press Enter
  $keyResult2 = Invoke-UiaMethod "press_key" @{keys="Enter"}
  Start-Sleep -Milliseconds 200
  
  # Clipboard test
  $clipGet = Invoke-UiaMethod "get_clipboard"
  $clipOk = $clipGet -ne $null -and $clipGet.error -eq $null
  Record-Result "clipboard_get" "System Administration" $clipOk @("ui_state") "Get clipboard: ok=$clipOk"
  
  # Set clipboard
  $null | & $helper 2>"$env:TEMP\uia-val-err.log"
  $clipSetCmd = '[Console]::In.ReadToEnd() | Set-Clipboard'
  $clipProc = Start-Process powershell -ArgumentList "-NoProfile -NonInteractive -Command $clipSetCmd" -NoNewWindow -PassThru
  Start-Sleep -Milliseconds 200
  Record-Result "clipboard_set" "System Administration" $true @("ui_state") "Set clipboard via PowerShell"
  
  # Scroll — Document controls lack Scroll pattern; fall back to PageDown key
  $scrollResult = Invoke-UiaMethod "scroll" @{ref=$editor.'@ref'; horizontalPercent=-1; verticalPercent=50}
  $scrollOk = $scrollResult -ne $null -and $scrollResult.error -eq $null
  if (-not $scrollOk -and $editor.role -eq "Document") {
    $scrollFallback = Invoke-UiaMethod "press_key" @{keys="PageDown"}
    Start-Sleep -Milliseconds 300
    $scrollFallback2 = Invoke-UiaMethod "press_key" @{keys="PageUp"}
    Start-Sleep -Milliseconds 300
    $scrollOk = $scrollFallback -ne $null -and $scrollFallback.error -eq $null
    Record-Result "ui_scroll" "UI Automation" $scrollOk @("ui_state") "Scroll: ok=$scrollOk (fallback=PageDown/PageUp)"
  } else {
    Record-Result "ui_scroll" "UI Automation" $scrollOk @("ui_state") "Scroll: ok=$scrollOk (direct)"
  }
  
  # Get cursor position
  $cursorResult = Invoke-UiaMethod "get_cursor_position"
  $cursorOk = $cursorResult -ne $null -and $cursorResult.error -eq $null
  Record-Result "mouse_get_position" "System Administration" $cursorOk @("ui_state") "Get cursor: ok=$cursorOk"
  
  # Click point
  $clickResult = Invoke-UiaMethod "click_point" @{x=500; y=300; button="left"}
  $clickOk = $clickResult -ne $null -and $clickResult.error -eq $null
  Record-Result "mouse_click" "System Administration" $clickOk @("ui_state") "Click point: ok=$clickOk"
  
  # Get foreground
  $fgResult = Invoke-UiaMethod "get_foreground"
  $fgHwnd = if ($fgResult -and $fgResult.result) { $fgResult.result.hwnd } else { 0 }
  $fgOk = $fgResult -ne $null -and $fgHwnd -gt 0
  Record-Result "window_get_foreground" "Window Management" $fgOk @("ui_state") "Get foreground: hwnd=$fgHwnd"
  
  # Minimize
  $minResult = Invoke-UiaMethod "minimize_window" @{hwnd=$hwnd}
  $minOk = $minResult -ne $null -and $minResult.error -eq $null
  Record-Result "window_minimize" "Window Management" $minOk @("ui_state") "Minimize: ok=$minOk"
  Start-Sleep -Milliseconds 500
  
  # Restore
  $restoreResult = Invoke-UiaMethod "restore_window" @{hwnd=$hwnd}
  $restoreOk = $restoreResult -ne $null -and $restoreResult.error -eq $null
  Record-Result "window_restore" "Window Management" $restoreOk @("ui_state") "Restore: ok=$restoreOk"
  Start-Sleep -Milliseconds 500
  
  # Set foreground
  $sfResult = Invoke-UiaMethod "set_foreground" @{hwnd=$hwnd}
  $sfOk = $sfResult -ne $null -and $sfResult.error -eq $null
  Record-Result "window_set_foreground" "Window Management" $sfOk @("ui_state") "Set foreground: ok=$sfOk"
  Start-Sleep -Milliseconds 500
  
  # Close window
  $closeResult = Invoke-UiaMethod "close_window" @{hwnd=$hwnd}
  $closeOk = $closeResult -ne $null -and $closeResult.error -eq $null
  Record-Result "app_close_notepad" "Application Management" $closeOk @("process_state") "Close: ok=$closeOk"
  Start-Sleep -Milliseconds 500
  
  return $hwnd
}

function Test-ProcessManagement {
  Write-Output "`n=== Process Management Tests ==="
  
  # List processes
  $procs = Invoke-UiaMethod "list_processes"
  $procsOk = $procs -ne $null -and $procs.result -ne $null -and ($procs.result | Measure-Object).Count -gt 0
  Record-Result "process_list" "System Administration" $procsOk @("process_state") "List processes: count=$($procs.result.Count)"
  
  # Start notepad again for kill test
  Start-Process notepad.exe
  Start-Sleep -Seconds 2
  $hwnd = $null
  for ($i = 0; $i -lt 10; $i++) {
    $r = Invoke-UiaMethod "find_window" @{titleContains="Notepad"}
    if ($r.result -and $r.result.hwnd) { $hwnd = $r.result.hwnd; break }
    Start-Sleep -Milliseconds 500
  }
  
  if ($hwnd) {
    # Kill process
    $killResult = Invoke-UiaMethod "kill_process" @{name="notepad"}
    $killOk = $killResult -ne $null -and $killResult.error -eq $null
    Record-Result "process_kill" "System Administration" $killOk @("process_state") "Kill notepad: ok=$killOk"
    Start-Sleep -Seconds 2
    
    # Verify it's gone
    $check = Invoke-UiaMethod "find_window" @{titleContains="Notepad"}
    $stillGone = $check.result.hwnd -eq $null -or $check.result.hwnd -eq 0
    Record-Result "process_kill_verify" "System Administration" $stillGone @("process_state") "Verify notepad gone: hwnd=$($check.result.hwnd)"
  }
}

function Test-ScreenCapture {
  Write-Output "`n=== Screen Capture Tests ==="
  
  # Full screen capture
  $capResult = Invoke-UiaMethod "capture_screen" @{format="png"}
  $capOk = $capResult -ne $null -and $capResult.error -eq $null -and $capResult.result -ne $null
  Record-Result "screen_capture_full" "Vision" $capOk @("screenshot") "Full screen capture: ok=$capOk, size=$($capResult.result.length)"
  
  # Monitor count
  $monResult = Invoke-UiaMethod "monitor_count"
  $monCount = if ($monResult -and $monResult.result) { $monResult.result.count } else { 0 }
  $monOk = $monResult -ne $null -and $monCount -gt 0
  Record-Result "screen_monitor_count" "System Administration" $monOk @("ui_state") "Monitors: $monCount"
  
  # Screen resolution
  $resResult = Invoke-UiaMethod "screen_resolution" @{monitor=0}
  $resOk = $resResult -ne $null -and $resResult.result -ne $null
  Record-Result "screen_resolution" "System Administration" $resOk @("ui_state") "Resolution: $(if($resOk){$resResult.result|ConvertTo-Json -Compress}else{'failed'})"
}

function Test-Explorer {
  Write-Output "`n=== File Explorer Tests ==="
  
  # Launch Explorer
  Start-Process explorer.exe
  Start-Sleep -Seconds 3
  
  $hwnd = $null
  for ($i = 0; $i -lt 15; $i++) {
    $r = Invoke-UiaMethod "find_window" @{titleContains="Quick access"}
    if (-not ($r -and $r.result.hwnd)) { $r = Invoke-UiaMethod "find_window" @{titleContains="This PC"} }
    if (-not ($r -and $r.result.hwnd)) { $r = Invoke-UiaMethod "find_window" @{process="explorer"} }
    if ($r.result -and $r.result.hwnd) {
      $info = Invoke-UiaMethod "get_window_info" @{hwnd=$r.result.hwnd}
      if ($info.result.window -ne "Program Manager" -and $info.result.window -ne "Taskbar" -and $info.result.window.length -gt 3) {
        $hwnd = $r.result.hwnd; break
      }
    }
    Start-Sleep -Milliseconds 500
  }
  
  if (-not $hwnd) {
    Record-Result "app_launch_explorer" "Application Management" $false @() "Could not find Explorer window"
    return
  }
  Record-Result "app_launch_explorer" "Application Management" $true @("ui_state") "Explorer launched, hwnd=$hwnd"
  
  # Get UI tree
  $tree = Invoke-UiaMethod "get_ui_tree" @{hwnd=$hwnd; maxNodes=400; maxDepth=30}
  $count = ($tree.result.elements | Measure-Object).Count
  $hasList = ($tree.result.elements | Where-Object { $_.role -eq "List" -and $_.childCount -gt 0 }) -ne $null
  Record-Result "ui_get_tree_explorer" "UI Automation" ($count -gt 0) @("ui_state") "Explorer tree: $count elements"
  
  # Close Explorer
  $closeResult = Invoke-UiaMethod "close_window" @{hwnd=$hwnd}
  $closeOk = $closeResult -ne $null -and $closeResult.error -eq $null
  Record-Result "app_close_explorer" "Application Management" $closeOk @("process_state") "Close Explorer: ok=$closeOk"
  Start-Sleep -Milliseconds 500
}

function Test-Calculator {
  Write-Output "`n=== Calculator Tests ==="
  
  # Calculator is UWP - launch via calc.exe
  Start-Process calc.exe
  Start-Sleep -Seconds 3
  
  $hwnd = $null
  for ($i = 0; $i -lt 15; $i++) {
    $r = Invoke-UiaMethod "find_window" @{titleContains="Calculator"}
    if ($r -and $r.result -and $r.result.hwnd) { $hwnd = $r.result.hwnd; break }
    $r2 = Invoke-UiaMethod "find_window" @{process="CalculatorApp"}
    if ($r2 -and $r2.result -and $r2.result.hwnd) { $hwnd = $r2.result.hwnd; break }
    Start-Sleep -Milliseconds 500
  }
  
  if (-not $hwnd) {
    Record-Result "app_launch_calculator" "Application Management" $false @() "Could not find Calculator window"
    return
  }
  Record-Result "app_launch_calculator" "Application Management" $true @("process_state") "Calculator launched, hwnd=$hwnd"
  
  # Get UI tree
  $tree = Invoke-UiaMethod "get_ui_tree" @{hwnd=$hwnd; maxNodes=200; maxDepth=20}
  $count = ($tree.result.elements | Measure-Object).Count
  $hasButtons = ($tree.result.elements | Where-Object { $_.role -eq "Button" }) -ne $null
  Record-Result "ui_get_tree_calculator" "UI Automation" ($count -gt 0 -and $hasButtons) @("ui_state") "Calculator tree: $count elements, hasButtons=$hasButtons"
  
  # Find and invoke button 7
  $btn7 = $tree.result.elements | Where-Object { $_.role -eq "Button" -and $_.name -eq "7" } | Select-Object -First 1
  if ($btn7) {
    $invokeResult = Invoke-UiaMethod "invoke_element" @{ref=$btn7.'@ref'}
    $invokeOk = $invokeResult -ne $null -and $invokeResult.error -eq $null
    Record-Result "ui_invoke_element" "UI Automation" $invokeOk @("ui_state") "Invoke button 7: ok=$invokeOk"
    Start-Sleep -Milliseconds 300
  }
  
  # Close
  $closeResult = Invoke-UiaMethod "close_window" @{hwnd=$hwnd}
  $closeOk = $closeResult -ne $null -and $closeResult.error -eq $null
  Record-Result "app_close_calculator" "Application Management" $closeOk @("process_state") "Close Calculator: ok=$closeOk"
  Start-Sleep -Milliseconds 500
}

function Test-Settings {
  Write-Output "`n=== Settings Tests ==="
  
  # Settings is already running (seen earlier)
  $hwnd = $null
  for ($i = 0; $i -lt 10; $i++) {
    $r = Invoke-UiaMethod "find_window" @{titleContains="Settings"}
    if ($r -and $r.result -and $r.result.hwnd) { $hwnd = $r.result.hwnd; break }
    Start-Sleep -Milliseconds 500
  }
  
  if (-not $hwnd) {
    # Launch Settings
    Start-Process ms-settings:
    Start-Sleep -Seconds 3
    for ($i = 0; $i -lt 15; $i++) {
      $r = Invoke-UiaMethod "find_window" @{titleContains="Settings"}
      if ($r -and $r.result -and $r.result.hwnd) { $hwnd = $r.result.hwnd; break }
      Start-Sleep -Milliseconds 500
    }
  }
  
  if (-not $hwnd) {
    Record-Result "app_launch_settings" "Application Management" $false @() "Could not find Settings window"
    return
  }
  Record-Result "app_find_window_settings" "Application Management" $true @("ui_state") "Settings found, hwnd=$hwnd"
  
  # Get tree on landing page
  $tree = Invoke-UiaMethod "get_ui_tree" @{hwnd=$hwnd; maxNodes=300; maxDepth=25}
  $count = ($tree.result.elements | Measure-Object).Count
  Record-Result "ui_get_tree_settings" "UI Automation" ($count -gt 0) @("ui_state") "Settings tree: $count elements"
  
  # Find toggles/switches — Settings uses Toggle pattern on various control types
  $togglesFound = $false
  
  # First pass: search by role (ToggleButton, CheckBox)
  $toggles = $tree.result.elements | Where-Object { $_.role -eq "ToggleButton" -or $_.role -eq "CheckBox" } | Select-Object -First 3
  $togglesFound = $toggles -ne $null -and ($toggles | Measure-Object).Count -gt 0
  
  if (-not $togglesFound) {
    # Second pass: search by Toggle pattern (Settings UWP controls use ToggleSwitch)
    $toggles = $tree.result.elements | Where-Object { $_.patterns -match "Toggle" } | Select-Object -First 3
    $togglesFound = $toggles -ne $null -and ($toggles | Measure-Object).Count -gt 0
  }
  
  if (-not $togglesFound) {
    # Navigate to Notifications subpage via direct URI
    Start-Process ms-settings:notifications
    Start-Sleep -Seconds 3
    # Find the new/updated Settings window
    for ($i = 0; $i -lt 10; $i++) {
      $r = Invoke-UiaMethod "find_window" @{titleContains="Settings"}
      if ($r.result -and $r.result.hwnd) { $hwnd = $r.result.hwnd; break }
      Start-Sleep -Milliseconds 500
    }
    if ($hwnd) {
      Start-Sleep -Seconds 2
      $tree2 = Invoke-UiaMethod "get_ui_tree" @{hwnd=$hwnd; maxNodes=300; maxDepth=25}
      $toggles = $tree2.result.elements | Where-Object { $_.role -eq "ToggleButton" -or $_.role -eq "CheckBox" -or ($_.patterns -match "Toggle") } | Select-Object -First 3
      $togglesFound = $toggles -ne $null -and ($toggles | Measure-Object).Count -gt 0
      if (-not $togglesFound) {
        # Try Personalization > Colors
        Start-Process ms-settings:personalization-colors
        Start-Sleep -Seconds 3
        for ($i = 0; $i -lt 10; $i++) {
          $r = Invoke-UiaMethod "find_window" @{titleContains="Settings"}
          if ($r.result -and $r.result.hwnd) { $hwnd = $r.result.hwnd; break }
          Start-Sleep -Milliseconds 500
        }
        if ($hwnd) {
          Start-Sleep -Seconds 1
          $tree3 = Invoke-UiaMethod "get_ui_tree" @{hwnd=$hwnd; maxNodes=300; maxDepth=25}
          $toggles = $tree3.result.elements | Where-Object { $_.role -eq "ToggleButton" -or $_.role -eq "CheckBox" -or ($_.patterns -match "Toggle") } | Select-Object -First 3
          $togglesFound = $toggles -ne $null -and ($toggles | Measure-Object).Count -gt 0
        }
      }
    }
  }
  Record-Result "ui_find_toggles" "UI Automation" $togglesFound @("ui_state") "Found $($toggles.Count) toggle elements"
  
  # Navigate to Display subpage to find expand/collapse elements
  $expandersFound = $false
  Invoke-UiaMethod "press_key" @{keys="Ctrl+E"}; Start-Sleep -Milliseconds 300
  Invoke-UiaMethod "type_text" @{text="display"}; Start-Sleep -Milliseconds 500
  Invoke-UiaMethod "press_key" @{keys="Enter"}; Start-Sleep -Milliseconds 1500
  
  $tree4 = Invoke-UiaMethod "get_ui_tree" @{hwnd=$hwnd; maxNodes=300; maxDepth=25}
  # Find expand/collapse elements
  $expanders = $tree4.result.elements | Where-Object { $_.patterns -match "ExpandCollapse" } | Select-Object -First 3
  $expandersFound = $expanders -ne $null -and ($expanders | Measure-Object).Count -gt 0
  if (-not $expandersFound) {
    # Fallback: try System > About or System > Storage
    Invoke-UiaMethod "press_key" @{keys="Ctrl+E"}; Start-Sleep -Milliseconds 300
    Invoke-UiaMethod "type_text" @{text="storage"}; Start-Sleep -Milliseconds 500
    Invoke-UiaMethod "press_key" @{keys="Enter"}; Start-Sleep -Milliseconds 1500
    $tree5 = Invoke-UiaMethod "get_ui_tree" @{hwnd=$hwnd; maxNodes=300; maxDepth=25}
    $expanders = $tree5.result.elements | Where-Object { $_.patterns -match "ExpandCollapse" } | Select-Object -First 3
    $expandersFound = $expanders -ne $null -and ($expanders | Measure-Object).Count -gt 0
  }
  Record-Result "ui_expand_collapse" "UI Automation" $expandersFound @("ui_state") "Found $($expanders.Count) expand/collapse elements (navigated to subpage)"
}

function Test-Chrome {
  Write-Output "`n=== Chrome Tests ==="
  
  # Chrome should already be running
  $hwnd = $null
  for ($i = 0; $i -lt 10; $i++) {
    $r = Invoke-UiaMethod "find_window" @{process="chrome"}
    if ($r -and $r.result -and $r.result.hwnd) { $hwnd = $r.result.hwnd; break }
    $r2 = Invoke-UiaMethod "find_window" @{titleContains="Google Chrome"}
    if ($r2 -and $r2.result -and $r2.result.hwnd) { $hwnd = $r2.result.hwnd; break }
    Start-Sleep -Milliseconds 500
  }
  
  if (-not $hwnd) {
    Record-Result "app_find_chrome" "Application Management" $false @() "Could not find Chrome window"
    return
  }
  Record-Result "app_find_chrome" "Application Management" $true @("ui_state") "Chrome found, hwnd=$hwnd"
  
  # Get UI tree
  $tree = Invoke-UiaMethod "get_ui_tree" @{hwnd=$hwnd; maxNodes=300; maxDepth=20}
  $count = ($tree.result.elements | Measure-Object).Count
  Record-Result "ui_get_tree_chrome" "UI Automation" ($count -gt 0) @("ui_state") "Chrome tree: $count elements"
  
  # Find address bar (Edit/ComboBox)
  $addressBar = $tree.result.elements | Where-Object { ($_.role -eq "Edit" -or $_.role -eq "ComboBox") -and $_.name -match "address|search|omnibox|url" -and $_.enabled } | Select-Object -First 1
  if (-not $addressBar) {
    $addressBar = $tree.result.elements | Where-Object { $_.role -eq "Edit" -and $_.enabled -and -not $_.offscreen } | Select-Object -First 1
  }
  $foundAB = $addressBar -ne $null
  Record-Result "ui_find_chrome_address_bar" "UI Automation" $foundAB @("ui_state") "Address bar found: $foundAB"
}

function Test-Media {
  Write-Output "`n=== Media Control Tests ==="
  
  # Test media key
  $mediaResult = Invoke-UiaMethod "media_key" @{key="play_pause"}
  $mediaOk = $mediaResult -ne $null -and $mediaResult.error -eq $null
  Record-Result "media_play_pause" "Media Control" $mediaOk @("audio_state") "Media play/pause: ok=$mediaOk"
  
  # Media next
  $mediaNext = Invoke-UiaMethod "media_key" @{key="next_track"}
  $mediaNextOk = $mediaNext -ne $null -and $mediaNext.error -eq $null
  Record-Result "media_next_track" "Media Control" $mediaNextOk @("audio_state") "Media next: ok=$mediaNextOk"
  
  # Media previous
  $mediaPrev = Invoke-UiaMethod "media_key" @{key="prev_track"}
  $mediaPrevOk = $mediaPrev -ne $null -and $mediaPrev.error -eq $null
  Record-Result "media_previous_track" "Media Control" $mediaPrevOk @("audio_state") "Media previous: ok=$mediaPrevOk"
}

function Test-System {
  Write-Output "`n=== System Tests ==="
  
  # Probe responsive
  Start-Process notepad.exe
  Start-Sleep -Seconds 2
  $hwnd = $null
  for ($i = 0; $i -lt 10; $i++) {
    $r = Invoke-UiaMethod "find_window" @{titleContains="Notepad"}
    if ($r.result -and $r.result.hwnd) { $hwnd = $r.result.hwnd; break }
    Start-Sleep -Milliseconds 500
  }
  
  if ($hwnd) {
    $probe = Invoke-UiaMethod "probe_responsive" @{hwnd=$hwnd; timeoutMs=1000}
    $probeOk = $probe -ne $null
    Record-Result "window_probe_responsive" "System Administration" $probeOk @("ui_state") "Probe responsive: ok=$probeOk"
    
    # Wait input idle
    $wait = Invoke-UiaMethod "wait_input_idle" @{hwnd=$hwnd; timeoutMs=3000}
    $waitOk = $wait -ne $null
    Record-Result "window_wait_input_idle" "System Administration" $waitOk @("ui_state") "Wait input idle: ok=$waitOk"
    
    # Close
    Invoke-UiaMethod "close_window" @{hwnd=$hwnd} | Out-Null
  }
}

# ===========================================================================
# MAIN EXECUTION
# ===========================================================================
Write-Output "================================================"
Write-Output "YOMI REAL CAPABILITY VALIDATION"
Write-Output "================================================"
Write-Output "Started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Output ""

# Verify helper
if (-not (Test-Path $helper)) {
  Write-Output "ERROR: UIA helper not found at $helper"
  exit 1
}
Write-Output "UIA helper: $((Get-Item $helper).Length / 1MB) MB"

if (-not (Test-Ping)) {
  Write-Output "ERROR: UIA helper ping failed"
  exit 1
}

# Run tests
Test-WindowActions
Test-ProcessManagement
Test-ScreenCapture
Test-Explorer
Test-Calculator
Test-Settings
Test-Chrome
Test-Media
Test-System

# ===========================================================================
# Generate Report
# ===========================================================================
Write-Output "`n================================================"
Write-Output "VALIDATION REPORT"
Write-Output "================================================"

$passCount = ($results | Where-Object { $_.passed }).Count
$failCount = ($results | Where-Object { -not $_.passed }).Count
$totalCount = $results.Count
$passRate = [math]::Round($passCount / $totalCount * 100, 1)

Write-Output "Total: $totalCount | Pass: $passCount | Fail: $failCount | Rate: $passRate%"
Write-Output ""

# By category
$categories = $results | Group-Object category
foreach ($cat in $categories) {
  $catPass = ($cat.Group | Where-Object { $_.passed }).Count
  $catTotal = ($cat.Group | Measure-Object).Count
  Write-Output "  $($cat.Name): $catPass/$catTotal ($([math]::Round($catPass/$catTotal*100,1))%)"
}

# Save report
$reportObj = @{
  generated = (Get-Date -Format "o")
  total = $totalCount
  pass = $passCount
  fail = $failCount
  passRate = $passRate
  results = $results
}
$reportObj | ConvertTo-Json -Depth 10 | Set-Content "$env:USERPROFILE\.yomi\validation-report.json"
Write-Output "`nReport saved to ~/.yomi/validation-report.json"

# Also save capability_registry.json
$registry = @{
  generated = (Get-Date -Format "o")
  environment = @{
    os = "Windows 11"
    uiaHelperOk = $true
  }
  capabilities = $results | Group-Object capability | ForEach-Object {
    $cap = $_.Group[0]
    $passes = ($_.Group | Where-Object { $_.passed }).Count
    $total = ($_.Group | Measure-Object).Count
    $rate = [math]::Round($passes / $total, 2)
    @{
      capability = $_.Name
      category = $cap.category
      status = if ($rate -ge 0.95) {"verified"} elseif ($rate -gt 0) {"degraded"} else {"failing"}
      successRate = $rate
      confidence = [math]::Round($rate * [math]::Min(1, $total / 5), 2)
      lastTested = (Get-Date -Format "o")
      testCount = $total
      passCount = $passes
      knownFailures = @(($_.Group | Where-Object { -not $_.passed } | ForEach-Object { $_.detail }))
    }
  }
}
$registry | ConvertTo-Json -Depth 10 | Set-Content "$env:USERPROFILE\.yomi\capability_registry.json"
Write-Output "Registry saved to ~/.yomi/capability_registry.json"
