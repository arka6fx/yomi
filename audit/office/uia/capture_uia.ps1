param([string]$OutputDir)

if (-not $OutputDir) { $OutputDir = $PSScriptRoot }

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Get-UiaElementInfo {
    param($Element, [int]$Depth = 0, [int]$MaxDepth = 3)
    if ($Depth -gt $MaxDepth) { return $null }
    if (-not $Element) { return $null }

    try {
        $info = @{
            ControlType = $Element.Current.ControlType.ProgrammaticName
            Name = $Element.Current.Name
            AutomationId = $Element.Current.AutomationId
            ClassName = $Element.Current.ClassName
            IsEnabled = $Element.Current.IsEnabled
            IsOffscreen = $Element.Current.IsOffscreen
            ProcessId = $Element.Current.ProcessId
        }

        $patterns = @()
        $supportedPatterns = $Element.GetSupportedPatterns()
        $patternMap = @{}
        $patternList = @("Invoke", "SelectionItem", "Value", "Text", "Window", "Scroll",
                        "ExpandCollapse", "Toggle", "RangeValue", "Grid", "Table",
                        "Dock", "Transform", "ScrollItem")

        foreach ($sp in $supportedPatterns) {
            $pn = $sp.ProgrammaticName
            if ($pn) { $patterns += $pn }
        }
        if ($patterns.Count -gt 0) { $info.SupportedPatterns = $patterns }

        $children = @()
        $treeWalker = [System.Windows.Automation.TreeWalker]::ContentViewWalker
        $child = $treeWalker.GetFirstChild($Element)
        while ($child) {
            $childInfo = Get-UiaElementInfo -Element $child -Depth ($Depth + 1) -MaxDepth $MaxDepth
            if ($childInfo) { $children += $childInfo }
            $child = $treeWalker.GetNextSibling($child)
        }
        if ($children.Count -gt 0) { $info.Children = $children }

        return $info
    } catch {
        return @{Error = $_.Exception.Message}
    }
}

Write-Host "Capturing UIA inventory for Office applications..."

$uiaInventory = @{}
$appWindows = @("WINWORD", "EXCEL", "POWERPNT", "ONENOTE", "OUTLOOK")

foreach ($processName in $appWindows) {
    Write-Host "  Scanning: $processName"
    $procs = Get-Process -Name $processName -ErrorAction SilentlyContinue
    $appInfo = @()

    if (-not $procs) {
        Write-Host "    No running instances."
        $uiaInventory[$processName] = @{
            ProcessName = $processName
            RunningInstances = 0
            Windows = @()
            Status = "Not running"
        }
        continue
    }

    foreach ($proc in $procs) {
        try {
            $rootElement = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
            if ($rootElement) {
                $info = Get-UiaElementInfo -Element $rootElement -MaxDepth 3
                if ($info) {
                    $info.ProcessName = $processName
                    $info.ProcessId = $proc.Id
                    $appInfo += $info
                }
            }
        } catch {
            Write-Host "    Error on PID $($proc.Id): $($_.Exception.Message)"
        }
    }

    $uiaInventory[$processName] = @{
        ProcessName = $processName
        RunningInstances = ($procs | Measure-Object).Count
        Windows = $appInfo
    }
}

$outputPath = Join-Path -Path $OutputDir -ChildPath "uia_inventory.json"
$uiaInventory | ConvertTo-Json -Depth 10 | Set-Content -Path $outputPath
Write-Host "UIA inventory saved to: $outputPath"
Write-Host "Done."
