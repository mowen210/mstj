' ============================================================
' Launched by Task Scheduler: start the server with a hidden window.
' The third Run() argument (True) waits for the process, which keeps
' the task in "Running"; if node crashes the task fails and Task
' Scheduler restarts it according to the configured restart policy.
' ============================================================
Option Explicit
Dim fso, sh, root, bat
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
bat = root & "\scripts\start-server.bat"

If Not fso.FileExists(bat) Then
  WScript.Quit 2
End If

sh.CurrentDirectory = root
sh.Run """" & bat & """", 0, True
