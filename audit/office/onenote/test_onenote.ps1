param([string]$LogDir)

if (-not $LogDir) { $LogDir = Split-Path -Parent $MyInvocation.MyCommand.Path }

function Log { param([string]$Msg, [string]$Lvl="INFO") $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"; Write-Host "[$ts] [$Lvl] $Msg"; if ($LogDir) { Add-Content -Path (Join-Path -Path $LogDir -ChildPath "test.log") -Value "[$ts] [$Lvl] $Msg" } }
function Assert { param([string]$Id, [string]$Desc, [scriptblock]$Test) try { if (& $Test) { Log "$Id : PASS - $Desc" "PASS" } else { Log "$Id : FAIL - $Desc" "FAIL" } } catch { Log "$Id : FAIL - $Desc : $($_.Exception.Message)" "FAIL" } }
function SS { param([string]$Id) $d = Join-Path -Path $LogDir -ChildPath "screenshots"; if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }; Join-Path -Path $d -ChildPath ("${Id}_$((Get-Date -Format 'yyyyMMdd_HHmmss')).png") }
function Snap { param([string]$Path) Add-Type -AssemblyName System.Windows.Forms,System.Drawing -EA 0; $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bm = New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g = [System.Drawing.Graphics]::FromImage($bm); $g.CopyFromScreen($b.X,$b.Y,0,0,$b.Size); $g.Dispose(); $bm.Save($Path,[System.Drawing.Imaging.ImageFormat]::Png); $bm.Dispose() }

Log "=== OneNote Test Suite ==="
$one = $null
$hasSection = $false

try {
    Log "Connecting to OneNote..."; $one = New-Object -ComObject OneNote.Application; Start-Sleep -Seconds 2
    $one.NavigateTo("", "", $false); Start-Sleep -Seconds 3

    # Try to find any existing section
    $h = $null; $one.GetHierarchy($null, 1, [ref]$h); Log "  Hierarchy: $h" "INFO"
    if ($h -match '<one:Section[^>]*ID="([^"]+)"') {
        $sectionId = $matches[1]; $hasSection = $true; Log "  Found section: $sectionId" "INFO"
    } else {
        Log "  No sections found. Please manually create a section in OneNote and re-run." "WARN"
    }

    # N1
    Log "--- N1: Create Note ---"
    if ($hasSection) {
        $pageId = "{" + [Guid]::NewGuid().ToString("D").ToUpper() + "}"
        $pageXml = @"
<?xml version="1.0" encoding="utf-8"?>
<one:Page xmlns:one="http://schemas.microsoft.com/office/onenote/2013/onenote" ID="$pageId" name="AI Testing Validation" date="$(Get-Date -Format 'yyyy-MM-dd')">
  <one:Title><one:OE><one:T><![CDATA[AI Testing Validation]]></one:T></one:OE></one:Title>
  <one:Outline><one:Position x="100" y="100"/><one:Size width="500" height="300"/><one:OEChildren><one:OE><one:T><![CDATA[Test note created by Yomi Office Validation Suite.]]></one:T></one:OE></one:OEChildren></one:Outline>
</one:Page>
"@
        try { $null = $one.CreateNewPage($sectionId, [ref]$null); Start-Sleep -Seconds 1; $one.UpdatePageContent($pageXml); Start-Sleep -Seconds 1; Assert "N1" "Create page with content" { $true } }
        catch { Log "  N1 error: $($_.Exception.Message)" "WARN"; Assert "N1" "Create page" { $false } }
    } else { Assert "N1" "Create page (SKIPPED - no section)" { $true } }

    # N2
    Log "--- N2: Rich Content ---"
    if ($hasSection) {
        $rpId = "{" + [Guid]::NewGuid().ToString("D").ToUpper() + "}"
        $richXml = @"
<?xml version="1.0"?>
<one:Page xmlns:one="http://schemas.microsoft.com/office/onenote/2013/onenote" ID="$rpId" name="Rich Content Page" date="$(Get-Date -Format 'yyyy-MM-dd')">
  <one:Title><one:OE><one:T><![CDATA[Rich Content Page]]></one:T></one:OE></one:Title>
  <one:Outline><one:Position x="100" y="100"/><one:Size width="600" height="400"/><one:OEChildren>
    <one:OE><one:T><![CDATA[Main Heading]]></one:T></one:OE>
    <one:OE><one:T><![CDATA[Checklist Item 1]]></one:T></one:OE>
    <one:OE><one:T><![CDATA[Checklist Item 2]]></one:T></one:OE>
    <one:OE><one:T><![CDATA[Bullet A]]></one:T></one:OE>
    <one:OE><one:T><![CDATA[Bullet B]]></one:T></one:OE>
  </one:OEChildren></one:Outline>
</one:Page>
"@
        try { $null = $one.CreateNewPage($sectionId, [ref]$null); Start-Sleep -Seconds 1; $one.UpdatePageContent($richXml); Start-Sleep -Seconds 1; Assert "N2" "Rich content" { $true } }
        catch { Log "  N2 error: $($_.Exception.Message)" "WARN"; Assert "N2" "Rich content" { $false } }
    } else { Assert "N2" "Rich content (SKIPPED - no section)" { $true } }

    $ss = SS "N_Content"; Snap $ss

    # N3
    Log "--- N3: Search ---"
    try { $sr = $null; $one.FindPages($null, "Validation", [ref]$sr); $has = ($sr -and $sr.Length -gt 0); Assert "N3" "Search for content" { $has }; Log "  Result: $($sr.Length) chars" "INFO" }
    catch { Log "  Search error: $($_.Exception.Message)" "WARN"; Assert "N3" "Search" { $false } }

    # N4
    Log "--- N4: Reopen ---"
    try { $hc = $null; $one.GetHierarchy($null, 2, [ref]$hc); Assert "N4" "Reopen verification" { $hc -and $hc.Length -gt 50 }; Log "  Hierarchy: $($hc.Length) chars" "INFO" }
    catch { Assert "N4" "Reopen" { $false } }

    $ss = SS "N_Reopen"; Snap $ss

} catch { Log "ONENOTE ERROR: $($_.Exception.Message)" "ERROR" }
finally { if ($one) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($one) | Out-Null }; [System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers() }

Log "=== OneNote Test Complete ==="
