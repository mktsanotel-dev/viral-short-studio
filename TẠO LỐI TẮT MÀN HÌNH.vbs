' Tạo biểu tượng "Viral Short Studio" ngoài màn hình (Desktop) cho tiện.
Option Explicit
Dim fso, sh, appDir, desktop, lnk, target
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
desktop = sh.SpecialFolders("Desktop")
target = appDir & "\MỞ PHẦN MỀM.vbs"

Set lnk = sh.CreateShortcut(desktop & "\Viral Short Studio.lnk")
lnk.TargetPath = target
lnk.WorkingDirectory = appDir
lnk.IconLocation = "shell32.dll,137"
lnk.Description = "Viral Short Studio - cắt video short viral"
lnk.Save

MsgBox "Đã tạo biểu tượng 'Viral Short Studio' trên màn hình!" & vbCrLf & _
       "Bấm đúp biểu tượng đó để mở phần mềm.", 64, "Xong"
