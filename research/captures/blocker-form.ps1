# blocker-form.ps1 - opaque borderless occluder window for capture tests.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -Namespace W -Name D -MemberDefinition '[DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int v);'
[W.D]::SetProcessDpiAwareness(2) | Out-Null
$f = New-Object System.Windows.Forms.Form
$f.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$f.StartPosition = 'Manual'
$f.Location = New-Object System.Drawing.Point(460, 460)
$f.Size = New-Object System.Drawing.Size(520, 520)
$f.BackColor = [System.Drawing.Color]::FromArgb(96, 30, 40)
$f.Text = 'BLOCKER'
$f.ShowInTaskbar = $false
$l = New-Object System.Windows.Forms.Label
$l.Text = 'BLOCKER-OCCLUDER'
$l.Font = New-Object System.Drawing.Font('Segoe UI', 20)
$l.ForeColor = [System.Drawing.Color]::White
$l.AutoSize = $true
$l.Location = New-Object System.Drawing.Point(30, 30)
$f.Controls.Add($l)
[System.Windows.Forms.Application]::Run($f)
