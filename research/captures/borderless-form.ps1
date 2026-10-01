# 테두리 없는 실험 창 — "앱 귀속 불가" 시나리오 재현용
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System.Runtime.InteropServices;
public class DpiHelper {
  [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int value);
}
"@
[DpiHelper]::SetProcessDpiAwareness(2) | Out-Null

$f = New-Object System.Windows.Forms.Form
$f.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$f.StartPosition = 'Manual'
$f.Location = New-Object System.Drawing.Point(520, 300)
$f.Size = New-Object System.Drawing.Size(760, 440)
$f.BackColor = [System.Drawing.Color]::FromArgb(28, 32, 40)

$l1 = New-Object System.Windows.Forms.Label
$l1.Text = 'ALPHA-4217'
$l1.Font = New-Object System.Drawing.Font('Segoe UI', 26, [System.Drawing.FontStyle]::Bold)
$l1.ForeColor = [System.Drawing.Color]::White
$l1.AutoSize = $true
$l1.Location = New-Object System.Drawing.Point(30, 24)
$f.Controls.Add($l1)

$l2 = New-Object System.Windows.Forms.Label
$l2.Text = "K7X-291  PLUME-OBSERVER  미세문자-8846"
$l2.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$l2.ForeColor = [System.Drawing.Color]::FromArgb(190, 200, 210)
$l2.AutoSize = $true
$l2.Location = New-Object System.Drawing.Point(32, 110)
$f.Controls.Add($l2)

$l3 = New-Object System.Windows.Forms.Label
$l3.Text = "이 창에는 테두리와 제목 표시줄이 없다 — 소속 앱을 픽셀만으로 알 수 없다"
$l3.Font = New-Object System.Drawing.Font('맑은 고딕', 9)
$l3.ForeColor = [System.Drawing.Color]::FromArgb(150, 158, 170)
$l3.AutoSize = $true
$l3.Location = New-Object System.Drawing.Point(32, 138)
$f.Controls.Add($l3)

[System.Windows.Forms.Application]::Run($f)
