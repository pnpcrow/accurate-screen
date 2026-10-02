# anim-window.ps1 - continuously GPU-rendered window (video/game proxy) with frame counter.
# Usage: powershell -STA -NoProfile -ExecutionPolicy Bypass -File anim-window.ps1 --title ANIM-DEMO --x 500 --y 400
# Renders a bouncing scene via CompositionTarget.Rendering (DirectX-composited like video/games)
# and draws the frame number + a rotating color bar, so consecutive captures prove LIVE buffer
# reads (frame number increases) rather than stale snapshots.
$argsv = $args
$x = 400; $y = 300; $size = 520; $title = 'ANIM-DEMO'
for ($i = 0; $i -lt $argsv.Count; $i++) {
  switch ($argsv[$i]) {
    '--x' { $i++; $x = [double]$argsv[$i] }
    '--y' { $i++; $y = [double]$argsv[$i] }
    '--size' { $i++; $size = [double]$argsv[$i] }
    '--title' { $i++; $title = $argsv[$i] }
  }
}

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -Namespace W -Name D -MemberDefinition '[DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int v);'
[W.D]::SetProcessDpiAwareness(2) | Out-Null

$win = New-Object System.Windows.Window
$win.WindowStyle = [System.Windows.WindowStyle]::None
$win.AllowsTransparency = $true
$win.Background = [System.Windows.Media.Brushes]::Transparent
$win.ShowInTaskbar = $false
$win.ShowActivated = $false
$win.Left = $x; $win.Top = $y; $win.Width = $size; $win.Height = $size
$win.Title = $title

# dark opaque stage + moving elements (drawn in code-behind via DrawingVisual host)
$host1 = New-Object System.Windows.Shapes.Rectangle
$host1.Width = $size; $host1.Height = $size
$host1.Fill = [System.Windows.Media.Brushes]::Transparent
$win.Content = $host1

$canvas = New-Object System.Windows.Controls.Canvas
$win.Content = $canvas

$bg = New-Object System.Windows.Shapes.Rectangle
$bg.Width = $size; $bg.Height = $size
$bg.Fill = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromRgb(18, 22, 30))
$canvas.Children.Add($bg) | Out-Null

$ball = New-Object System.Windows.Shapes.Ellipse
$ball.Width = 90; $ball.Height = 90
$ball.Fill = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromRgb(255, 170, 60))
[System.Windows.Controls.Canvas]::SetLeft($ball, 40); [System.Windows.Controls.Canvas]::SetTop($ball, 40)
$canvas.Children.Add($ball) | Out-Null

$bar = New-Object System.Windows.Shapes.Rectangle
$bar.Width = $size; $bar.Height = 26
$bar.Fill = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromRgb(90, 200, 250))
[System.Windows.Controls.Canvas]::SetTop($bar, 0)
$canvas.Children.Add($bar) | Out-Null

$tb = New-Object System.Windows.Controls.TextBlock
$tb.Text = 'FRAME 0'
$tb.FontSize = 44
$tb.FontWeight = [System.Windows.FontWeights]::Bold
$tb.Foreground = [System.Windows.Media.Brushes]::White
$tb.Background = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(200, 40, 40, 48))
[System.Windows.Controls.Canvas]::SetLeft($tb, 120); [System.Windows.Controls.Canvas]::SetTop($tb, ($size - 90))
$canvas.Children.Add($tb) | Out-Null

$win.Show()

$script:fx = 1.0; $script:fy = 1.0
$script:bx = 40.0; $script:by = 40.0
$script:frame = 0
$handler = {
  $script:frame++
  $script:bx += 6.0 * $script:fx
  $script:by += 5.0 * $script:fy
  if ($script:bx -lt 0 -or ($script:bx + 90) -gt $size) { $script:fx = -$script:fx }
  if ($script:by -lt 0 -or ($script:by + 90) -gt ($size - 80)) { $script:fy = -$script:fy }
  [System.Windows.Controls.Canvas]::SetLeft($ball, $script:bx)
  [System.Windows.Controls.Canvas]::SetTop($ball, $script:by)
  $tb.Text = "FRAME $script:frame"
  $tbCanvas = $null
}
# WPF는 무효화가 없으면 렌더 루프를 돌리지 않으므로(CompositionTarget.Rendering이 정지함),
# DispatcherTimer로 UI 스레드에서 강제 무효화한다 — 동영상/게임류 연속 렌더링의 대리 물성.
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(16)
$timer.Add_Tick($handler)
$timer.Start()
[System.Windows.Threading.Dispatcher]::Run()
