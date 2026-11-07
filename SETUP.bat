@echo off
rem ============================================================
rem  AutoTest - Cai dat nhanh tren Windows
rem  Double-click file nay de cai dat. File chi la lop vo:
rem  tu nang quyen Admin roi goi scripts\setup.ps1
rem  (toan bo logic cai dat nam trong setup.ps1).
rem ============================================================
setlocal
cd /d "%~dp0"

rem --- Chua co quyen Admin thi tu nang quyen roi chay lai ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Dang yeu cau quyen Admin de cai dat...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1"
set "EXITCODE=%errorlevel%"
echo.
if "%EXITCODE%"=="0" (
    echo Hoan tat cai dat.
) else (
    echo Cai dat dung lai, ma loi %EXITCODE%. Xem thong bao o tren va muc Xu ly su co trong docs\HUONG-DAN-MAY-THAT.md
)
pause
exit /b %EXITCODE%
