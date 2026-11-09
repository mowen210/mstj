# ============================================================
# 取消开机自启：删除计划任务，并结束正在跑的后端进程
#
#   powershell -ExecutionPolicy Bypass -File scripts\uninstall-autostart.ps1
# ============================================================
param([string]$TaskName = "CanyinWeb")

$ErrorActionPreference = "Continue"

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch {}
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host ("✔ 已删除计划任务：" + $TaskName) -ForegroundColor Green
} else {
  Write-Host ("没有找到计划任务 " + $TaskName + "，无需删除。")
}

# 结束本项目的 node 进程（只杀命令行里带 server.js 且工作目录是本项目的）
$AppDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$killed = 0
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match 'server\.js' } |
  ForEach-Object {
    try {
      $cwd = (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).Path
      Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
      $killed++
      Write-Host ("已结束 node 进程 PID " + $_.ProcessId)
    } catch {}
  }
if (-not $killed) { Write-Host "没有发现正在运行的后端进程（或无权结束）。" }

Write-Host "图片仍在 uploads/，数据仍在 MySQL，重启方式：scripts\start-server.bat"
