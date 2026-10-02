# animal-window.ps1 - transparent borderless image window for attribution stress test.
# Usage: powershell -STA -NoProfile -ExecutionPolicy Bypass -File animal-window.ps1 --target --kind dog --x 300 --y 200
#   --target      prints "TARGET kind=<kind> pid=<pid>" to stdout, then shows the window
#   --background  prints nothing
#   --kind NAME   one of: dog cat rabbit bird fish (random if omitted)
#   --x/--y/--size  window position (DIP) and size
$argsv = $args
$mode = 'background'; $kind = $null; $x = 100; $y = 100; $size = 380; $title = ''
for ($i = 0; $i -lt $argsv.Count; $i++) {
  switch ($argsv[$i]) {
    '--target' { $mode = 'target' }
    '--background' { $mode = 'background' }
    '--kind' { $i++; $kind = $argsv[$i] }
    '--x' { $i++; $x = [double]$argsv[$i] }
    '--y' { $i++; $y = [double]$argsv[$i] }
    '--size' { $i++; $size = [double]$argsv[$i] }
    '--title' { $i++; $title = $argsv[$i] }
  }
}
$kinds = @('dog', 'cat', 'rabbit', 'bird', 'fish')
if ($kind -and ($kinds -notcontains $kind)) { Write-Error "unknown kind: $kind"; exit 2 }
if (-not $kind) { $kind = Get-Random -InputObject $kinds }

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -Namespace W -Name D -MemberDefinition '[DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int v);'
[W.D]::SetProcessDpiAwareness(2) | Out-Null

$base = 'C:/Develop/agents-works/accurate-screen/research/captures/animals'
$win = New-Object System.Windows.Window
$win.WindowStyle = [System.Windows.WindowStyle]::None
$win.AllowsTransparency = $true
$win.Background = [System.Windows.Media.Brushes]::Transparent
$win.ShowInTaskbar = $false
$win.ShowActivated = $false
$win.Left = $x
$win.Top = $y
$win.Width = $size
$win.Height = $size
$img = New-Object System.Windows.Controls.Image
$img.Source = New-Object System.Windows.Media.Imaging.BitmapImage([Uri]"file:///$base/$kind.png")
$img.Stretch = [System.Windows.Media.Stretch]::Uniform
$win.Content = $img
$win.Title = $title
$win.Show()

if ($mode -eq 'target') {
  [Console]::Out.WriteLine("TARGET kind=$kind pid=$PID mode=target")
  [Console]::Out.Flush()
}
[System.Windows.Threading.Dispatcher]::Run()
