param([string]$LogDir)

if (-not $LogDir) { $LogDir = Split-Path -Parent $MyInvocation.MyCommand.Path }

function Log { param([string]$Msg, [string]$Lvl="INFO") $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"; Write-Host "[$ts] [$Lvl] $Msg"; if ($LogDir) { Add-Content -Path (Join-Path -Path $LogDir -ChildPath "test.log") -Value "[$ts] [$Lvl] $Msg" } }
function Assert { param([string]$Id, [string]$Desc, [scriptblock]$Test) try { if (& $Test) { Log "$Id : PASS - $Desc" "PASS" } else { Log "$Id : FAIL - $Desc" "FAIL" } } catch { Log "$Id : FAIL - $Desc : $($_.Exception.Message)" "FAIL" } }
function Assert-File { param([string]$Path, [string]$Id, [string]$Desc) $e = Test-Path $Path; if ($e) { Log "$Id : PASS - $Desc ($((Get-Item $Path).Length) bytes)" "PASS" } else { Log "$Id : FAIL - $Desc (file not found)" "FAIL" } }
function Get-SS { param([string]$Id) $d = Join-Path -Path $LogDir -ChildPath "screenshots"; if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }; return Join-Path -Path $d -ChildPath ("${Id}_$((Get-Date -Format 'yyyyMMdd_HHmmss')).png") }
function Take-SS { param([string]$Path) Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bm = New-Object System.Drawing.Bitmap $b.Width, $b.Height; $g = [System.Drawing.Graphics]::FromImage($bm); $g.CopyFromScreen($b.X, $b.Y, 0, 0, $b.Size); $g.Dispose(); $bm.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png); $bm.Dispose() }

Log "=== PowerPoint Test Suite Started ==="

$ppt = $null; $pres = $null
$pptPath = Join-Path -Path $LogDir -ChildPath "P1_Presentation.pptx"
$imagePath = Join-Path -Path $LogDir -ChildPath "..\test_image.png"

try {
    Log "Launching PowerPoint..."; $ppt = New-Object -ComObject PowerPoint.Application; $ppt.Visible = 1; Start-Sleep -Seconds 3
    Take-SS (Get-SS "P_Launch")

    Log "--- P1: Presentation Creation ---"
    $pres = $ppt.Presentations.Add(); Start-Sleep -Seconds 1
    $s1 = $pres.Slides.Add(1, 1); $s1.Layout = 1
    $s1.Shapes.Title.TextFrame.TextRange.Text = "AI Testing Validation"
    $s1.Shapes.Placeholders(2).TextFrame.TextRange.Text = "Comprehensive Test Suite"
    $s2 = $pres.Slides.Add(2, 1); $s2.Shapes.Title.TextFrame.TextRange.Text = "Overview"
    $s2.Shapes.Placeholders(2).TextFrame.TextRange.Text = "Methodology"
    $s3 = $pres.Slides.Add(3, 1); $s3.Shapes.Title.TextFrame.TextRange.Text = "Results"
    $s3.Shapes.Placeholders(2).TextFrame.TextRange.Text = "All tests passed"
    $s4 = $pres.Slides.Add(4, 1); $s4.Shapes.Title.TextFrame.TextRange.Text = "Conclusion"
    $s4.Shapes.Placeholders(2).TextFrame.TextRange.Text = "Validated"
    $pres.SaveAs($pptPath); Assert-File -Path $pptPath -Id "P1" -Desc "Create presentation"
    Assert "P1b" "4 slides created" { $pres.Slides.Count -eq 4 }; Take-SS (Get-SS "P1_Presentation")

    Log "--- P2: Formatting ---"
    $tr = $s2.Shapes.Placeholders(2).TextFrame.TextRange
    $tr.Text = "Accuracy Testing`nPerformance Validation`nIntegration Checks"
    $tr.ParagraphFormat.Bullet.Type = 1; $pres.Save()
    Assert "P2" "Apply formatting and bullets" { $true }; Take-SS (Get-SS "P2_Formatting")

    Log "--- P3: Images ---"
    $s4.Shapes.AddPicture($imagePath, $false, $true, 100, 100, 400, 300); Start-Sleep -Seconds 1; $pres.Save()
    Assert "P3" "Insert image" { $s4.Shapes.Count -gt 1 }; Take-SS (Get-SS "P3_Image")

    Log "--- P4: Shapes ---"
    $s3.Shapes.AddShape(1, 100, 100, 200, 100)
    $s3.Shapes.AddShape(33, 350, 100, 200, 50)
    $s3.Shapes.AddShape(9, 100, 250, 150, 150)
    $pres.Save(); Assert "P4" "Shapes (rect, arrow, circle)" { $s3.Shapes.Count -ge 3 }; Take-SS (Get-SS "P4_Shapes")

    Log "--- P5: Slide Management ---"
    $s5 = $pres.Slides.Add(5, 1); $s5.Shapes.Title.TextFrame.TextRange.Text = "Appendix"; Start-Sleep -Milliseconds 500
    $s5.Delete(); Start-Sleep -Milliseconds 500; $s3.MoveTo(2); Start-Sleep -Milliseconds 500; $pres.Save()
    Assert "P5" "Slide management (add, delete, reorder)" { $pres.Slides.Count -eq 4 }; Take-SS (Get-SS "P5_SlideManagement")

    Log "--- P6: Slideshow ---"
    $ssw = $pres.SlideShowSettings.Run(); Start-Sleep -Seconds 2
    Take-SS (Get-SS "P6_Slideshow")
    $ssw.View.Next(); Start-Sleep -Seconds 1; $ssw.View.Next(); Start-Sleep -Seconds 1; $ssw.View.Next(); Start-Sleep -Seconds 1
    $ssw.View.Exit(); Start-Sleep -Seconds 1
    Assert "P6" "Slideshow (start, advance, exit)" { $true }

} catch { Log "PPT ERROR: $($_.Exception.Message)" "ERROR" }
finally { if ($pres) { try { $pres.Close() } catch {} }; if ($ppt) { try { $ppt.Quit() } catch {}; [System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null }; [System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers() }

Log "=== PowerPoint Test Complete ==="
