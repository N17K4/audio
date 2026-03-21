@echo off
:: test_facefusion_clone.bat — 最小 PATH で test_facefusion_clone.ps1 を実行
:: git が PATH に含まれないため、zip 回退パスを強制的にテストする
::
:: 用法：
::   scripts\test_facefusion_clone.bat
::   直接ダブルクリックでも可
setlocal

:: 最小 PATH：Windows システムディレクトリのみ（git を含まない）
set "PATH=%SystemRoot%\system32;%SystemRoot%;%SystemRoot%\System32\Wbem"
set "SystemRoot=%SystemRoot%"
set "TEMP=%TEMP%"
set "TMP=%TMP%"
set "USERPROFILE=%USERPROFILE%"

echo ============================================
echo   FaceFusion clone test (no-git environment)
echo ============================================
echo.
echo PATH=%PATH%
echo.

where git >nul 2>&1
if %errorlevel% equ 0 (
    echo [WARN] git is still reachable — test may not simulate no-git env
) else (
    echo [OK] git not found in PATH — zip fallback will be tested
)
echo.

:: git clone を直接実行 — PATH に git がないので失敗するはず
echo [TEST] git clone --depth 1 --branch 3.5.4 facefusion...
git clone --depth 1 --branch 3.5.4 https://github.com/facefusion/facefusion.git "%~dp0..\cache\facefusion" 2>&1

echo.
if %errorlevel% equ 0 (
    echo [UNEXPECTED] git clone succeeded — git is reachable in this env
) else (
    echo [EXPECTED] git clone failed with exit code %errorlevel% — confirms no-git env
)

echo.
pause
endlocal
