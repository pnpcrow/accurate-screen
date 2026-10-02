# launch-round.ps1 - kill existing animal-window instances, then launch background instances.
# Spec format: "mode,kind,x,y;mode,kind,x,y;..."  (mode: background|target, positions in DIP)
# The target instance should be launched separately (so its stdout can be captured).
param([string]$Spec)

# 1) kill previous instances
$prev = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like '*animal-window.ps1*' }
foreach ($p in $prev) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 600

# 2) launch background instances
$script = 'C:\Develop\agents-works\accurate-screen\research\captures\animal-window.ps1'
$instances = $Spec -split ';' | Where-Object { $_ -and $_.Trim() }
foreach ($inst in $instances) {
  $p = $inst -split ','
  $mode = $p[0].Trim(); $kind = $p[1].Trim(); $x = [double]$p[2]; $y = [double]$p[3]
  if ($mode -eq 'target') { continue }  # target is launched by the caller
  $argList = @('-STA', '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', $script,
    "--$mode", '--kind', $kind, '--x', "$x", '--y', "$y")
  Start-Process powershell -ArgumentList $argList
  Write-Output "launched mode=$mode kind=$kind x=$x y=$y"
}

# 3) report the full instance map (pid -> args) for ground truth
Start-Sleep -Milliseconds 1200
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like '*animal-window.ps1*' } |
  ForEach-Object { "PID $($_.ProcessId): $($_.CommandLine.Substring($_.CommandLine.IndexOf('animal-window.ps1')))" }
