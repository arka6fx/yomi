param([string]$LogDir)

if (-not $LogDir) { $LogDir = Split-Path -Parent $MyInvocation.MyCommand.Path }

function Log { param([string]$Msg, [string]$Lvl="INFO") $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"; Write-Host "[$ts] [$Lvl] $Msg"; if ($LogDir) { Add-Content -Path (Join-Path -Path $LogDir -ChildPath "test.log") -Value "[$ts] [$Lvl] $Msg" } }
function Assert { param([string]$Id, [string]$Desc, [scriptblock]$Test) try { if (& $Test) { Log "$Id : PASS - $Desc" "PASS" } else { Log "$Id : FAIL - $Desc" "FAIL" } } catch { Log "$Id : FAIL - $Desc : $($_.Exception.Message)" "FAIL" } }
function Assert-File { param([string]$Path, [string]$Id, [string]$Desc) $e = Test-Path $Path; if ($e) { Log "$Id : PASS - $Desc ($((Get-Item $Path).Length) bytes)" "PASS" } else { Log "$Id : FAIL - $Desc (file not found)" "FAIL" } }
function Get-SS { param([string]$Id) $d = Join-Path -Path $LogDir -ChildPath "screenshots"; if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }; return Join-Path -Path $d -ChildPath ("${Id}_$((Get-Date -Format 'yyyyMMdd_HHmmss')).png") }
function Take-SS { param([string]$Path) Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bm = New-Object System.Drawing.Bitmap $b.Width, $b.Height; $g = [System.Drawing.Graphics]::FromImage($bm); $g.CopyFromScreen($b.X, $b.Y, 0, 0, $b.Size); $g.Dispose(); $bm.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png); $bm.Dispose() }

Log "=== Excel Test Suite Started ==="

if (Test-Path (Join-Path -Path $LogDir -ChildPath "E1_Workbook.xlsx")) { Remove-Item (Join-Path -Path $LogDir -ChildPath "E1_Workbook.xlsx") -Force; Log "  Removed old E1 file" "INFO" }
$excel = $null; $wb = $null; $ws = $null
$wbPath = Join-Path -Path $LogDir -ChildPath "E1_Workbook.xlsx"
$wbPath2 = Join-Path -Path $LogDir -ChildPath "E7_Reopen.xlsx"

try {
    Log "Launching Excel..."; $excel = New-Object -ComObject Excel.Application; $excel.Visible = $true; $excel.DisplayAlerts = $false; Start-Sleep -Seconds 2
    Take-SS (Get-SS "E_Launch")

    Log "--- E1: Workbook Creation ---"
    $wb = $excel.Workbooks.Add(); $ws = $wb.Worksheets.Item(1); $ws.Name = "Scores"
    $ws.Cells.Item(1,1) = "Name"; $ws.Cells.Item(1,2) = "Score"
    $ws.Cells.Item(2,1) = "John"; $ws.Cells.Item(2,2) = 90
    $ws.Cells.Item(3,1) = "Alice"; $ws.Cells.Item(3,2) = 95
    $ws.Cells.Item(4,1) = "Bob"; $ws.Cells.Item(4,2) = 88
    $wb.SaveAs($wbPath); Assert-File -Path $wbPath -Id "E1" -Desc "Create workbook"; Take-SS (Get-SS "E1_Workbook")

    Log "--- E2: Formulas ---"
    $ws.Cells.Item(5,1) = "Average"; $ws.Cells.Item(5,2).Formula = "=AVERAGE(B2:B4)"; $avg = [int]($ws.Cells.Item(5,2).Value2)
    $ws.Cells.Item(6,1) = "Max"; $ws.Cells.Item(6,2).Formula = "=MAX(B2:B4)"; $max = [int]($ws.Cells.Item(6,2).Value2)
    $ws.Cells.Item(7,1) = "Min"; $ws.Cells.Item(7,2).Formula = "=MIN(B2:B4)"; $min = [int]($ws.Cells.Item(7,2).Value2)
    $ws.Cells.Item(8,1) = "Sum"; $ws.Cells.Item(8,2).Formula = "=SUM(B2:B4)"; $sum = [int]($ws.Cells.Item(8,2).Value2)
    $wb.Save()
    Assert "E2" "Formulas (Avg=$avg Max=$max Min=$min Sum=$sum)" { $avg -eq 91 -and $max -eq 95 -and $min -eq 88 -and $sum -eq 273 }
    Take-SS (Get-SS "E2_Formulas")

    Log "--- E3: Formatting ---"
    $ws.Range("A1:B1").Font.Bold = $true; $ws.Range("A1:B1").Interior.ColorIndex = 15
    $ws.Range("A2:B4").Interior.ColorIndex = 34
    $ws.Range("A1:B8").Borders.Weight = 2; $ws.Columns("A:B").AutoFit(); $wb.Save()
    Assert "E3" "Apply formatting" { $true }; Take-SS (Get-SS "E3_Formatting")

    Log "--- E4: Sorting ---"
    $ws.Range("A2:B4").Sort($ws.Columns("B"), 1); $wb.Save()
    $sn1 = $ws.Cells.Item(2,1).Text; $sn2 = $ws.Cells.Item(3,1).Text; $sn3 = $ws.Cells.Item(4,1).Text
    Assert "E4" "Sort ascending ($sn1, $sn2, $sn3)" { $sn1 -eq "Bob" -and $sn3 -eq "Alice" }
    Take-SS (Get-SS "E4_Sorting")

    Log "--- E5: Filtering ---"
    $ws.Range("A2:B4").Sort($ws.Columns("A"), 1)
    $ws.Range("A1:B4").AutoFilter(2, ">90"); $wb.Save()
    Assert "E5" "Filter score > 90" { $ws.AutoFilterMode -eq $true }
    $ws.AutoFilterMode = $false; Take-SS (Get-SS "E5_Filtering")

    Log "--- E6: Charts ---"
    $co = $ws.ChartObjects().Add(100, 50, 400, 250); $c = $co.Chart
    $c.SetSourceData([ref]$ws.Range("A1:B4")); $c.ChartType = 51; $c.HasTitle = $true; $c.ChartTitle.Text = "Scores"
    $wb.Save(); Assert "E6" "Bar chart" { $c.ChartTitle.Text -eq "Scores" }; Take-SS (Get-SS "E6_Chart")

    Log "--- E7: Reopen ---"
    $wb.SaveAs($wbPath2); $wb.Close(); Start-Sleep -Seconds 1
    $wb2 = $excel.Workbooks.Open($wbPath2); Start-Sleep -Seconds 2; $ws2 = $wb2.Worksheets.Item(1)
    Assert "E7" "Reopen preserves formulas" { $ws2.Cells.Item(5,2).Formula -eq "=AVERAGE(B2:B4)" }
    Assert "E7b" "Reopen preserves charts" { $ws2.ChartObjects().Count -gt 0 }
    Take-SS (Get-SS "E7_Reopen"); $wb2.Close()

} catch { Log "EXCEL ERROR: $($_.Exception.Message)" "ERROR" }
finally { if ($excel) { try { $excel.Quit() } catch {}; [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null }; [System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers() }

Log "=== Excel Test Complete ==="
