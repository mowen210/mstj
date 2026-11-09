# ============================================================
# 把「餐饮图鉴 Web 版」设为开机自启（Windows 任务计划程序）
#
#   右键“使用 PowerShell 运行”，或：
#   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
#
#   常用参数：
#     -DelaySeconds 20     登录后延迟多少秒启动（默认 20，等 MySQL 先起来）
#     -AtStartup           开机就启动、不要求登录（需要管理员权限）
#     -StartNow            注册完立刻启动一次
#     -TaskName CanyinWeb  任务名
#
# 卸载：scripts\uninstall-autostart.ps1
# ============================================================
param(
  [string]$TaskName = "CanyinWeb",
  [int]$DelaySeconds = 20,
  [string]$AppDir = "",
  [switch]$AtStartup,
  [switch]$StartNow
)

$ErrorActionPreference = "Stop"

if (-not $AppDir) { $AppDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
$AppDir = (Resolve-Path $AppDir).Path
$vbs = Join-Path $AppDir "scripts\start-hidden.vbs"
$bat = Join-Path $AppDir "scripts\start-server.bat"

Write-Host "== 餐饮图鉴 · 开机自启配置 ==" -ForegroundColor Cyan
Write-Host ("应用目录：" + $AppDir)

# ---------- 前置检查 ----------
if (-not (Test-Path $vbs)) { throw "找不到启动脚本：$vbs" }
if (-not (Test-Path $bat)) { throw "找不到批处理：$bat" }

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw "找不到 node 命令，请先安装 Node.js 并确认它在 PATH 里" }
Write-Host ("Node：" + $node.Source)

$envFile = Join-Path $AppDir ".env"
if (Test-Path $envFile) {
  $cfg = Get-Content $envFile -Encoding UTF8
  $portLine = $cfg | Where-Object { $_ -match '^\s*PORT\s*=' } | Select-Object -First 1
  $tokLine  = $cfg | Where-Object { $_ -match '^\s*ADMIN_TOKEN\s*=' } | Select-Object -First 1
  $port = if ($portLine) { ($portLine -split '=', 2)[1].Trim() } else { "3000" }
  Write-Host ("端口：" + $port + "（来自 .env）")
  if ($tokLine -and $tokLine -match 'change-me') {
    Write-Warning "ADMIN_TOKEN 还是 change-me，自启后管理端等于没口令保护，建议先改掉再开机自启。"
  }
} else {
  Write-Warning "没有找到 .env，会使用默认值（端口 3000、口令 change-me、数据库 canyin）。请先跑一次 npm run db:init 并配好 .env。"
}

$svc = Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'mysql|maria' }
if ($svc) {
  $svc | ForEach-Object {
    Write-Host ("数据库服务：" + $_.Name + "  状态=" + $_.Status + "  启动类型=" + $_.StartType)
    if ($_.StartType -ne "Automatic") {
      Write-Warning ("服务 " + $_.Name + " 不是自动启动，开机后数据库不会起来。管理员执行：Set-Service " + $_.Name + " -StartupType Automatic")
    }
  }
} else {
  Write-Warning "没检测到 MySQL/MariaDB 服务。网页能启动，但连不上库时页面会提示「没能连上数据库」。"
}

# ---------- 注册任务 ----------
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument ('"' + $vbs + '"') -WorkingDirectory $AppDir

if ($AtStartup) {
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  Write-Host "模式：开机即启动（SYSTEM，无需登录）"
} else {
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  try { $trigger.Delay = "PT${DelaySeconds}S" } catch { Write-Warning "当前系统不支持设置延迟，将立即启动" }
  $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
  Write-Host ("模式：登录后 " + $DelaySeconds + " 秒启动（当前用户）")
}

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

try {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal `
    -Settings $settings -Description "餐饮图鉴 Web 版（Node + MySQL），隐藏窗口常驻，崩溃自动重启" -Force | Out-Null
} catch {
  if ($AtStartup) {
    throw "注册失败：" + $_.Exception.Message + "`n开机自启需要管理员权限：用管理员身份打开 PowerShell 再执行本脚本。"
  }
  throw "注册失败：" + $_.Exception.Message
}

$info = Get-ScheduledTask -TaskName $TaskName
Write-Host ""
Write-Host ("✔ 已注册计划任务：" + $TaskName + "  状态=" + $info.State) -ForegroundColor Green
Write-Host ("   触发：" + ($(if ($AtStartup) { "开机" } else { "登录后 " + $DelaySeconds + " 秒" })))
Write-Host ("   动作：wscript.exe `"" + $vbs + "`"")
Write-Host  "   日志：$AppDir\logs\server.log"
Write-Host  "   访问：http://127.0.0.1:3000/   （端口以 .env 的 PORT 为准）"

if ($StartNow) {
  Start-ScheduledTask -TaskName $TaskName
  Start-Sleep -Seconds 3
  $st = (Get-ScheduledTask -TaskName $TaskName).State
  Write-Host ("已尝试启动，当前状态：" + $st) -ForegroundColor Green
  Write-Host "若 30 秒后仍打不开页面，看日志：Get-Content '$AppDir\logs\server.log' -Tail 20"
}

Write-Host ""
Write-Host "卸载：powershell -ExecutionPolicy Bypass -File scripts\uninstall-autostart.ps1"
