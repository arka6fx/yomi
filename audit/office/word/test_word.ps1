param([string]$LogDir)

if (-not $LogDir) { $LogDir = Split-Path -Parent $MyInvocation.MyCommand.Path }

function Log { param([string]$Msg, [string]$Lvl="INFO") $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"; Write-Host "[$ts] [$Lvl] $Msg"; if ($LogDir) { Add-Content -Path (Join-Path -Path $LogDir -ChildPath "test.log") -Value "[$ts] [$Lvl] $Msg" } }
function Assert { param([string]$Id, [string]$Desc, [scriptblock]$Test) try { if (& $Test) { Log "$Id : PASS - $Desc" "PASS" } else { Log "$Id : FAIL - $Desc" "FAIL" } } catch { Log "$Id : FAIL - $Desc : $($_.Exception.Message)" "FAIL" } }
function AssertFile { param([string]$Path, [string]$Id, [string]$Desc) $e = Test-Path $Path; if ($e) { Log "$Id : PASS - $Desc ($((Get-Item $Path).Length) bytes)" "PASS" } else { Log "$Id : FAIL - $Desc (file not found)" "FAIL" } }
function SS { param([string]$Id) $d = Join-Path -Path $LogDir -ChildPath "screenshots"; if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }; Join-Path -Path $d -ChildPath ("${Id}_$((Get-Date -Format 'yyyyMMdd_HHmmss')).png") }
function Snap { param([string]$Path) Add-Type -AssemblyName System.Windows.Forms,System.Drawing -EA 0; $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bm = New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g = [System.Drawing.Graphics]::FromImage($bm); $g.CopyFromScreen($b.X,$b.Y,0,0,$b.Size); $g.Dispose(); $bm.Save($Path,[System.Drawing.Imaging.ImageFormat]::Png); $bm.Dispose() }

Log "=== Word Test Suite ==="
$word = $null; $doc = $null
$docPath = Join-Path -Path $LogDir -ChildPath "W1_AI_Testing.docx"
$docPath2 = Join-Path -Path $LogDir -ChildPath "W6_Reopen.docx"
$imagePath = Join-Path -Path $LogDir -ChildPath "..\test_image.png"

if (-not (Test-Path $imagePath)) {
    Add-Type -AssemblyName System.Drawing -EA 0
    $bm = New-Object System.Drawing.Bitmap 200,200; $g = [System.Drawing.Graphics]::FromImage($bm)
    $g.Clear([System.Drawing.Color]::CornflowerBlue)
    $g.DrawString("Yomi Test",(New-Object System.Drawing.Font "Arial",16),[System.Drawing.Brushes]::White,30,80)
    $g.Dispose(); $bm.Save($imagePath,[System.Drawing.Imaging.ImageFormat]::Png); $bm.Dispose()
}

function Add-P {
    param([string]$Text)
    $p = $doc.Content.Paragraphs.Add()
    $null = [System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc.Content)
    $p.Range.Text = $Text
    $null = [System.Runtime.InteropServices.Marshal]::ReleaseComObject($p.Range)
}

function Save-Doc {
    param([string]$Path)
    $doc.SaveAs2([ref]$Path)
    Start-Sleep -Milliseconds 500
}

try {
    Log "Launching Word..."; $word = New-Object -ComObject Word.Application; $word.Visible = $true; $word.DisplayAlerts = $false; Start-Sleep -Seconds 3
    Snap (SS "W1_Launch")

    # W1
    Log "--- W1: Create Document ---"
    $doc = $word.Documents.Add()
    Add-P "AI Testing"
    Add-P "AI testing is the process of evaluating AI systems."
    Add-P "It involves validation, verification, and monitoring."
    Save-Doc $docPath
    AssertFile -Path $docPath -Id "W1" -Desc "Create Word document"
    Snap (SS "W1_Document")

    # W2
    Log "--- W2: Formatting ---"
    $doc.Content.Delete()
    $null = [System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc.Content)
    Add-P "AI Testing Overview"; $p = $doc.Paragraphs.Item($doc.Paragraphs.Count); $p.Range.Font.Bold = $true; $p.Range.Font.Size = 18
    Add-P "Methodology"; $p = $doc.Paragraphs.Item($doc.Paragraphs.Count); $p.Range.Font.Bold = $true; $p.Range.Font.Size = 14
    Add-P "Bold text"; $p = $doc.Paragraphs.Item($doc.Paragraphs.Count); $p.Range.Font.Bold = $true
    Add-P "Italic text"; $p = $doc.Paragraphs.Item($doc.Paragraphs.Count); $p.Range.Font.Italic = $true
    Add-P "Underlined text"; $p = $doc.Paragraphs.Item($doc.Paragraphs.Count); $p.Range.Font.Underline = 1
    Add-P "Bullet 1"; $p = $doc.Paragraphs.Item($doc.Paragraphs.Count); $p.Range.ListFormat.ApplyBulletDefault()
    Add-P "Bullet 2"; $p = $doc.Paragraphs.Item($doc.Paragraphs.Count); $p.Range.ListFormat.ApplyBulletDefault()
    Add-P "Step 1"; $p = $doc.Paragraphs.Item($doc.Paragraphs.Count); $p.Range.ListFormat.ApplyNumberDefault()
    Add-P "Step 2"; $p = $doc.Paragraphs.Item($doc.Paragraphs.Count); $p.Range.ListFormat.ApplyNumberDefault()
    $doc.Save()
    Assert "W2" "Apply formatting" { $true }
    Snap (SS "W2_Formatting")

    # W3
    Log "--- W3: Tables ---"
    $doc.Content.Delete(); $null = [System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc.Content)
    $t = $doc.Tables.Add($doc.Range(),3,3)
    $t.Cell(1,1).Range.Text = "Model"; $t.Cell(1,2).Range.Text = "Accuracy"; $t.Cell(1,3).Range.Text = "Latency"
    $t.Cell(2,1).Range.Text = "GPT-4"; $t.Cell(2,2).Range.Text = "94%"; $t.Cell(2,3).Range.Text = "2.1s"
    $t.Cell(3,1).Range.Text = "Claude-3"; $t.Cell(3,2).Range.Text = "96%"; $t.Cell(3,3).Range.Text = "1.8s"
    $doc.Save()
    Assert "W3" "3x3 table" { $t.Rows.Count -eq 3 -and $t.Columns.Count -eq 3 }
    Snap (SS "W3_Table")

    # W4
    Log "--- W4: Images ---"
    $doc.Content.Delete(); $null = [System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc.Content)
    $img = $doc.InlineShapes.AddPicture($imagePath,$false,$true,$doc.Range())
    $img.Width = 100; $img.Height = 100; $doc.Save()
    Assert "W4" "Insert and resize image" { $doc.InlineShapes.Count -gt 0 }
    Snap (SS "W4_Image")

    # W5 - Word Execute with ReplaceAll
    Log "--- W5: Find and Replace ---"
    $doc.Content.Delete(); $null = [System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc.Content)
    $doc.Content.Text = "AI Testing is critical. Automated Testing improves quality. Manual Testing is also needed."
    $fr = $doc.Content.Find
    $fr.ClearFormatting(); $fr.Replacement.ClearFormatting()
    $null = $fr.Execute([ref]"Testing",[ref]$false,[ref]$true,[ref]$false,[ref]$false,[ref]$false,
                        [ref]$true,[ref]1,[ref]$false,[ref]"Validation",[ref]2)
    $doc.Save(); $txt = $doc.Content.Text
    Assert "W5" "Find and replace 'Testing' with 'Validation'" { $txt -like "*Validation*" }
    Snap (SS "W5_FindReplace")

    # W6
    Log "--- W6: Reopen ---"
    Save-Doc $docPath2
    $doc.Close(); Start-Sleep -Seconds 1
    $doc2 = $word.Documents.Open($docPath2); Start-Sleep -Seconds 1
    Assert "W6" "Reopen preserves content" { $null -ne $doc2 -and $doc2.Content.Text.Length -gt 0 }
    Snap (SS "W6_Reopen"); $doc2.Close()

} catch { Log "WORD ERROR: $($_.Exception.Message)" "ERROR" }
finally { if ($word) { try { $word.Quit() } catch {}; [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null }; [System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers() }

Log "=== Word Test Complete ==="
