@echo off
setlocal
cd /d "%~dp0"

echo.
echo DISORDER119 - Freigestellte Produktfotos
echo =========================================
echo Dieses Programm arbeitet lokal und verwendet keine KI- oder Codex-Tokens.
echo Fortschritt, ETA und Wiederaufnahme werden automatisch gespeichert.
echo.

if /i "%~1"=="auto" goto vollimport

py -3 tools\import_cutout_photos.py --interactive
set "IMPORT_EXIT=%ERRORLEVEL%"
goto ende

:vollimport
echo Vollimport wird gestartet oder ab dem letzten fertigen Foto fortgesetzt ...
echo.
py -3 -u tools\import_cutout_photos.py --mode apply --confirm JA-BILDER-ERSETZEN --skip-asset-backup --max-mib 2.0 --max-edge 2400 --workers 12
set "IMPORT_EXIT=%ERRORLEVEL%"

:ende
echo.
if not "%IMPORT_EXIT%"=="0" echo Der Fotoimport wurde mit einem Fehler beendet.
if "%IMPORT_EXIT%"=="0" echo Der lokale Fotoimport ist vollstaendig abgeschlossen.
pause
exit /b %IMPORT_EXIT%
