@echo off
set "DEST=%LOCALAPPDATA%\LEPocket"
if not exist "%DEST%" mkdir "%DEST%"
copy /Y "%~dp0LE-Pocket.html" "%DEST%\LE-Pocket.html" >nul
copy /Y "%~dp0LE-Pocket.ico" "%DEST%\LE-Pocket.ico" >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=$env:LOCALAPPDATA+'\LEPocket'; $e=(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe' -ErrorAction SilentlyContinue).'(default)'; if(-not $e){$e=(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe' -ErrorAction SilentlyContinue).'(default)'}; if(-not $e){$e='msedge.exe'}; $u='file:///'+(($d+'\LE-Pocket.html') -replace '\\','/' -replace ' ','%%20'); foreach($p in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))){ $s=(New-Object -ComObject WScript.Shell).CreateShortcut($p+'\LE Pocket.lnk'); $s.TargetPath=$e; $s.Arguments='--app='+$u; $s.IconLocation=$d+'\LE-Pocket.ico'; $s.Save() }"
echo.
echo LE Pocket instalado. Abra pelo atalho "LE Pocket" na Area de Trabalho ou no Menu Iniciar.
pause
