param([string]$LogDir, [int]$Iterations = 20)

if (-not $LogDir) { $LogDir = Split-Path -Parent $MyInvocation.MyCommand.Path }

function Log { param([string]$Msg, [string]$Lvl="INFO") $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss.fff"; Write-Host "[$ts] [$Lvl] $Msg"; if ($LogDir) { Add-Content -Path (Join-Path -Path $LogDir -ChildPath "test.log") -Value "[$ts] [$Lvl] $Msg" } }

Log "=== STRESS TEST: $Iterations iterations ==="

$results = @()

function Run-Workflow {
    param([string]$Name, [scriptblock]$Workflow, [int]$N)
    Log "  Workflow: $Name ($N iterations)"
    $times = @(); $ok = 0; $fail = 0; $errs = @()
    for ($i = 1; $i -le $N; $i++) {
        $start = Get-Date
        try { & $Workflow; $ok++; $times += ((Get-Date) - $start).TotalMilliseconds }
        catch { $fail++; $times += ((Get-Date) - $start).TotalMilliseconds; $errs += @{i=$i; e=$_.Exception.Message} }
    }
    $avg = [math]::Round(($times | Measure-Object -Average).Average); $mx = [math]::Round(($times | Measure-Object -Maximum).Maximum); $mn = [math]::Round(($times | Measure-Object -Minimum).Minimum)
    $rate = [math]::Round($ok / $N * 100, 1)
    Log "    $ok/$N OK, $rate%, avg=${avg}ms min=${mn}ms max=${mx}ms"
    return @{Workflow=$Name; Iterations=$N; Successes=$ok; Failures=$fail; SuccessRate=$rate; AvgLatencyMs=$avg; MaxLatencyMs=$mx; MinLatencyMs=$mn; ErrorDetails=$errs}
}

try {
    Log "Launching Office apps..."; $word = New-Object -ComObject Word.Application; $word.Visible = $false
    $excel = New-Object -ComObject Excel.Application; $excel.Visible = $false
    $ppt = New-Object -ComObject PowerPoint.Application; $ppt.Visible = 0

    $results += Run-Workflow -Name "Word_Save" -N $Iterations -Workflow {
        $d = $word.Documents.Add(); $d.Content.Text = "Stress test iteration"
        $tp = [System.IO.Path]::GetTempFileName().Replace(".tmp",".docx"); $d.SaveAs2($tp); $d.Close()
        if (Test-Path $tp) { Remove-Item $tp -Force }
    }

    $results += Run-Workflow -Name "Excel_Formulas" -N $Iterations -Workflow {
        $wb = $excel.Workbooks.Add(); $ws = $wb.Worksheets.Item(1)
        $ws.Cells.Item(1,1) = 10; $ws.Cells.Item(2,1) = 20; $ws.Cells.Item(3,1) = 30
        $ws.Cells.Item(4,1).Formula = "=SUM(A1:A3)"; $ws.Cells.Item(5,1).Formula = "=AVERAGE(A1:A3)"
        $tp = [System.IO.Path]::GetTempFileName().Replace(".tmp",".xlsx"); $wb.SaveAs($tp); $wb.Close()
        if (Test-Path $tp) { Remove-Item $tp -Force }
    }

    $results += Run-Workflow -Name "PowerPoint_Slides" -N $Iterations -Workflow {
        $p = $ppt.Presentations.Add()
        $p.Slides.Item(1).Shapes.Title.TextFrame.TextRange.Text = "Title"
        $s2 = $p.Slides.Add(2,1); $s2.Shapes.Title.TextFrame.TextRange.Text = "Overview"
        $tp = [System.IO.Path]::GetTempFileName().Replace(".tmp",".pptx"); $p.SaveAs($tp); $p.Close()
        if (Test-Path $tp) { Remove-Item $tp -Force }
    }

} catch { Log "STRESS ERROR: $($_.Exception.Message)" "ERROR" }
finally { try { $word.Quit(); [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null } catch {}; try { $excel.Quit(); [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null } catch {}; try { $ppt.Quit(); [System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null } catch {}; [System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers() }

$report = @{Timestamp=(Get-Date -Format "o"); Iterations=$Iterations; Workflows=$results; Overall=@{
    TotalRuns=($results | ForEach-Object {$_.Iterations} | Measure-Object -Sum).Sum
    TotalFailures=($results | ForEach-Object {$_.Failures} | Measure-Object -Sum).Sum
    AvgLatency=[math]::Round(($results | ForEach-Object {$_.AvgLatencyMs} | Measure-Object -Average).Average)}}
$report | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path -Path $LogDir -ChildPath "stress_results.json")
Log "=== Stress test complete ==="
return $report
