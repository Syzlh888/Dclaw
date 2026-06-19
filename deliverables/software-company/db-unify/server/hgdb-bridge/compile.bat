@echo off
cd /d "%~dp0"
echo Compiling HgdbBridge.java...
javac HgdbBridge.java
if %errorlevel% equ 0 (
    echo √ HgdbBridge.class compiled successfully
) else (
    echo X Compilation failed. Make sure Java JDK is installed (javac command required).
    echo   Download from: https://adoptium.net/
)
pause
