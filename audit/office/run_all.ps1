param([switch]$RunStress, [int]$StressIterations = 20)

$rootDir = $PSScriptRoot
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$reportDir = Join-Path -Path $rootDir -ChildPath "report_$timestamp"
New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path -Path $reportDir -ChildPath "screenshots") -Force | Out-Null

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  YOMI - Microsoft Office Validation Suite" -ForegroundColor Cyan
Write-Host "  Started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
Write-Host "  Report:  $reportDir" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

$overall = @{Timestamp=(Get-Date -Format "o"); TestSuiteVersion="1.0"; Apps=@{}; Overall=@{}}

$suites = @(
    @{Name="Word"; Script="word\test_word.ps1"}
    @{Name="Excel"; Script="excel\test_excel.ps1"}
    @{Name="PowerPoint"; Script="powerpoint\test_ppt.ps1"}
    @{Name="Outlook"; Script="outlook\test_outlook.ps1"}
    @{Name="OneNote"; Script="onenote\test_onenote.ps1"}
)

foreach ($s in $suites) {
    Write-Host "`n--- Running: $($s.Name) ---" -ForegroundColor Yellow
    $appDir = Join-Path -Path $rootDir -ChildPath $s.Name.ToLower()
    $script = Join-Path -Path $rootDir -ChildPath $s.Script
    try {
        & $script -LogDir $appDir
        Write-Host "  $($s.Name): OK" -ForegroundColor Green

        # Count pass/fail from log
        $logFile = Join-Path -Path $appDir -ChildPath "test.log"
        if (Test-Path $logFile) {
            $log = Get-Content $logFile
            $pass = ($log | Select-String "PASS").Count
            $fail = ($log | Select-String "FAIL").Count
            $overall.Apps[$s.Name] = @{Status="Completed"; Passed=$pass; Failed=$fail}

            Copy-Item $logFile (Join-Path -Path $reportDir -ChildPath "$($s.Name)_test.log")
        } else {
            $overall.Apps[$s.Name] = @{Status="Completed (no log)"}
        }

        # Copy screenshots
        $ssSrc = Join-Path -Path $appDir -ChildPath "screenshots"
        if (Test-Path $ssSrc) {
            $ssDst = Join-Path -Path $reportDir -ChildPath "screenshots\$($s.Name)"
            New-Item -ItemType Directory -Path $ssDst -Force | Out-Null
            Copy-Item -Path "$ssSrc\*" -Destination $ssDst -Force
        }
    } catch {
        Write-Host "  $($s.Name): FAILED - $($_.Exception.Message)" -ForegroundColor Red
        $overall.Apps[$s.Name] = @{Status="Error"; Error=$_.Exception.Message}
    }
}

# UIA Inventory
Write-Host "`n--- UIA Inventory ---" -ForegroundColor Yellow
try { & (Join-Path -Path $rootDir -ChildPath "uia\capture_uia.ps1") -OutputDir $reportDir; $overall.UIAInventory="Captured" }
catch { $overall.UIAInventory="Failed: $($_.Exception.Message)" }

# Stress Tests
if ($RunStress) {
    Write-Host "`n--- Stress Tests ($StressIterations iter) ---" -ForegroundColor Yellow
    try { $sr = & (Join-Path -Path $rootDir -ChildPath "stress\run_stress.ps1") -LogDir $reportDir -Iterations $StressIterations; $overall.Stress=$sr }
    catch { $overall.Stress=@{Error=$_.Exception.Message} }
} else { Write-Host "  Stress: skipped (-RunStress)" -ForegroundColor Gray; $overall.Stress="Skipped" }

# Certification
Write-Host "`n=============================================" -ForegroundColor Cyan
Write-Host "  Certification" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

$allCert = $true
foreach ($app in @("Word","Excel","PowerPoint","Outlook","OneNote")) {
    $a = $overall.Apps[$app]
    $cert = $false; $reason = ""
    if (-not $a) { $cert = $false; $reason = "No results" }
    elseif ($a.Error) { $cert = $false; $reason = "Error: $($a.Error)" }
    elseif ($a.Failed -and $a.Failed -gt 0) { $cert = $false; $reason = "$($a.Failed) test(s) failed" }
    elseif ($a.Passed -ge 0) { $cert = $true }
    else { $cert = $false; $reason = "Unknown" }

    $icon = if ($cert) { "PASS" } else { "FAIL" }; $color = if ($cert) { "Green" } else { "Red" }
    Write-Host "  [$icon] $app" -ForegroundColor $color
    if ($reason) { Write-Host "        $reason" -ForegroundColor Gray }
    if (-not $cert) { $allCert = $false }
}

$overall.Overall = @{AllCertified=$allCert; Summary=if ($allCert){"ALL CERTIFIED"}else{"SOME NOT CERTIFIED"}}
Write-Host "`nResult: $($overall.Overall.Summary)" -ForegroundColor $(if ($allCert){"Green"}else{"Red"})

$overall | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path -Path $reportDir -ChildPath "certification_report.json")
Write-Host "Report: $reportDir/certification_report.json" -ForegroundColor Cyan
return $overall
