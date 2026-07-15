' Watchdog Viral Short Studio: kiểm tra server, nếu CHẾT thì tự bật lại (ẩn, không cửa sổ đen).
' Chạy 1 lần rồi thoát — để Scheduled Task gọi lại định kỳ.
Option Explicit
Dim fso, sh, appDir
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = appDir

If Not ServerUp() Then
  ' server chết → bật lại ẩn
  sh.Run "cmd /c node ""server.mjs""", 0, False
End If

Function ServerUp()
  On Error Resume Next
  Dim h
  Set h = CreateObject("MSXML2.XMLHTTP")
  h.Open "GET", "http://localhost:5178/api/health", False
  h.Send
  ServerUp = (Err.Number = 0 And h.Status = 200)
  On Error GoTo 0
End Function
