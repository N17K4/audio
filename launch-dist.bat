@echo off
:: launch-dist.bat — 以最小环境变量启动 Windows dist，模拟真实用户环境
:: 前置条件：已运行 pnpm run setup && pnpm run dist:win
setlocal

set APP_EXE=%~dp0dist\win-arm64-unpacked\AI Tool.exe
set PYTHON_BIN=%~dp0dist\win-arm64-unpacked\resources\runtime\win\python\python.exe

if not exist "%APP_EXE%" (
    echo ERROR: App 不存在，请先运行 pnpm run dist:win
    pause
    exit /b 1
)

if not exist "%PYTHON_BIN%" (
    echo WARN: 内置 Python 未找到，backend 将无法启动（请先 pnpm run setup）
)

echo 启动: %APP_EXE%
cmd /c "set PATH=%SystemRoot%\system32;%SystemRoot%;%SystemRoot%\System32\Wbem && set SystemRoot=%SystemRoot% && set SystemDrive=%SystemDrive% && set USERPROFILE=%USERPROFILE% && set HOMEDRIVE=%HOMEDRIVE% && set HOMEPATH=%HOMEPATH% && set APPDATA=%APPDATA% && set LOCALAPPDATA=%LOCALAPPDATA% && set USERNAME=%USERNAME% && set COMPUTERNAME=%COMPUTERNAME% && set TEMP=%TEMP% && set TMP=%TMP% && start \"\" \"%APP_EXE%\""

endlocal
