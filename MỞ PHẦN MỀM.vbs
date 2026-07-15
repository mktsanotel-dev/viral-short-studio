' Viral Short Studio - mở dạng CỬA SỔ APP (không thanh địa chỉ trình duyệt).
' Chạy server ẩn (không cửa sổ đen), chờ sẵn sàng rồi mở cửa sổ app.
Option Explicit
Dim fso, sh, appDir, url, i
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = appDir
url = "http://localhost:5178"

' Nếu server chưa chạy thì khởi động ẩn
If Not ServerUp(url) Then
  sh.Run "cmd /c node ""server.mjs""", 0, False
End If

' Chờ server sẵn sàng (tối đa ~25 giây)
For i = 1 To 50
  If ServerUp(url) Then Exit For
  WScript.Sleep 500
Next

OpenApp url

Function ServerUp(u)
  On Error Resume Next
  Dim h
  Set h = CreateObject("MSXML2.XMLHTTP")
  h.Open "GET", u & "/api/health", False
  h.Send
  ServerUp = (Err.Number = 0 And h.Status = 200)
  On Error GoTo 0
End Function

Sub OpenApp(u)
  On Error Resume Next
  ' Ưu tiên Microsoft Edge (có sẵn mọi máy Windows) ở chế độ app
  Dim edge
  edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
  If fso.FileExists(edge) Then
    sh.Run """" & edge & """ --app=" & u & " --window-size=520,940", 1, False
  Else
    ' fallback: Chrome, hoặc trình duyệt mặc định
    Dim chrome
    chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
    If fso.FileExists(chrome) Then
      sh.Run """" & chrome & """ --app=" & u, 1, False
    Else
      sh.Run u, 1, False
    End If
  End If
  On Error GoTo 0
End Sub
