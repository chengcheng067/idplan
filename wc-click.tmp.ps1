param([string]$Mode,[int]$ProcId,[int]$X,[int]$Y)
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public struct RECT { public int Left, Top, Right, Bottom; }
public struct PNT { public int X, Y; }
public class WI5 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern void mouse_event(int f, int dx, int dy, int d, int e);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void keybd_event(byte b, byte scan, int flags, int extra);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, int flags);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref PNT p);
  public static readonly IntPtr HWND_TOP = IntPtr.Zero;
}
'@
$p = Get-Process -Id $ProcId -ErrorAction SilentlyContinue
$h = $p.MainWindowHandle

if ($Mode -eq 'origin') {
  if ($h -ne 0) {
    # 重置窗口位置/尺寸到固定值（SWP_SHOWWINDOW=0x40 | SWP_NOZORDER=0x10）
    [WI5]::SetWindowPos($h, [WI5]::HWND_TOP, 573, 245, 1415, 909, 0x50) | Out-Null
    Start-Sleep -Milliseconds 140
    for ($i = 0; $i -lt 3; $i++) {
      [WI5]::SetForegroundWindow($h) | Out-Null
      Start-Sleep -Milliseconds 130
      if ([WI5]::GetForegroundWindow() -eq $h) { break }
    }
    $r = New-Object RECT
    [WI5]::GetClientRect($h, [ref]$r) | Out-Null
    $pt = New-Object PNT
    [WI5]::ClientToScreen($h, [ref]$pt) | Out-Null
    Write-Output ("ORIGIN {0} {1} CLIENT {2} {3} FG {4}" -f $pt.X, $pt.Y, ($r.Right - $r.Left), ($r.Bottom - $r.Top), ([WI5]::GetForegroundWindow() -eq $h))
  }
} elseif ($Mode -eq 'origin-nr') {
  $r = New-Object RECT
  [WI5]::GetClientRect($h, [ref]$r) | Out-Null
  $pt = New-Object PNT
  [WI5]::ClientToScreen($h, [ref]$pt) | Out-Null
  [WI5]::SetForegroundWindow($h) | Out-Null
  Start-Sleep -Milliseconds 120
  Write-Output ("ORIGIN {0} {1} CLIENT {2} {3} FG {4}" -f $pt.X, $pt.Y, ($r.Right - $r.Left), ($r.Bottom - $r.Top), ([WI5]::GetForegroundWindow() -eq $h))
} else {
  # 取消可能残留的窗口拖动/缩放循环
  [WI5]::keybd_event(0x1B, 0, 0, 0); Start-Sleep -Milliseconds 40; [WI5]::keybd_event(0x1B, 0, 2, 0)
  Start-Sleep -Milliseconds 120
  [WI5]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds 130
  [WI5]::mouse_event(2, 0, 0, 0, 0)
  Start-Sleep -Milliseconds 60
  [WI5]::mouse_event(4, 0, 0, 0, 0)
}
