# Đăng ký Scheduled Task tự khởi động lại server Viral Short Studio khi bị tắt.
$vbs = Join-Path $PSScriptRoot "watchdog.vbs"
$a = New-ScheduledTaskAction -Execute "wscript.exe" -Argument ('"' + $vbs + '"')
$t = New-ScheduledTaskTrigger -Once -At (Get-Date)
$t.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 2)).Repetition
$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "HMH-ViralStudio-Watchdog" -Action $a -Trigger $t -Settings $s -Force | Out-Null
Write-Host "Da bat TU KHOI DONG LAI: cu 2 phut kiem tra, server chet thi tu bat lai."
