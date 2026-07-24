@echo off
cd /d "%~dp0"
echo Compiling HgdbBridge.java (target: Java 8 compatible, class version 52.0)...
javac --release 8 -encoding UTF-8 HgdbBridge.java
if %errorlevel% neq 0 (
    echo --release 8 not supported, fallback to -source 1.8 -target 1.8
    javac -source 1.8 -target 1.8 -encoding UTF-8 HgdbBridge.java
)
if %errorlevel% equ 0 (
    echo √ HgdbBridge.class compiled successfully - Java 8 compatible
) else (
    echo X Compilation failed. Make sure Java JDK is installed (javac command required).
    echo   Download from: https://adoptium.net/
)
pause
