@echo off
rem Prueft, ob jedes Shop-Bild noch zu seinem freigestellten Bild passt und ob es neue Freisteller gibt.
rem Liest nur, veraendert nichts.
cd /d "%~dp0.."
py -3 tools\fotoquellen.py pruefen
echo.
pause
