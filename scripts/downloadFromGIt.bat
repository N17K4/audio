@echo off
:: run_facefusion_test.bat — test_facefusion_clone.ps1 のランチャー
:: ダブルクリックで実行可
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0test_facefusion_clone.ps1"
echo.
pause
endlocal
