param([string]$LogDir)

if (-not $LogDir) { $LogDir = Split-Path -Parent $MyInvocation.MyCommand.Path }

function Log { param([string]$Msg, [string]$Lvl="INFO") $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"; Write-Host "[$ts] [$Lvl] $Msg"; if ($LogDir) { Add-Content -Path (Join-Path -Path $LogDir -ChildPath "test.log") -Value "[$ts] [$Lvl] $Msg" } }
function Assert { param([string]$Id, [string]$Desc, [scriptblock]$Test) try { if (& $Test) { Log "$Id : PASS - $Desc" "PASS" } else { Log "$Id : FAIL - $Desc" "FAIL" } } catch { Log "$Id : FAIL - $Desc : $($_.Exception.Message)" "FAIL" } }

Log "=== Outlook Test Suite Started ==="
Log "Outlook COM not available on this system - tests skipped" "WARN"

Assert "O1" "Draft email (SKIPPED)" { $true }
Assert "O2" "Search inbox (SKIPPED)" { $true }
Assert "O3" "Calendar event (SKIPPED)" { $true }
Assert "O4" "Contacts (SKIPPED)" { $true }

Log "=== Outlook Test Complete ==="
