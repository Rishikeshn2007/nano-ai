@echo off
rem ------------------------------------------------------------
rem install.bat – Installs NanoAI for Windows (batch)
rem Requires: Node.js 18+ in your PATH
rem Place this file next to your nanoai.js or adjust paths below.
rem ------------------------------------------------------------

setlocal EnableDelayedExpansion

:: 1️⃣ Detect the folder that contains *this* script
set "ScriptDir=%~dp0"

:: 2️⃣ Absolute path to the real NanoAI source (adjust if you moved it)
set "NanoSource=%ScriptDir%bin\nanoai.js"

if NOT exist "%NanoSource%" (
    echo ERROR: Cannot find nanoai.js at "%NanoSource%"
    goto :eof
)

:: 3️⃣ Verify Node 18+ is available in the current PATH
for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node"') do set MajorNode=%%V

if NOT defined MajorNode (
    echo ERROR: Node.js not found in PATH. Install it from https://nodejs.org/
    goto :eof
)

if %MajorNode% LSS 18 (
    echo ERROR: Detected Node v%MajorNode%.0 – Node 18+ is required.
    goto :eof
)

:: 4️⃣ Create a per‑user bin folder (C:\Users\<you>\AppData\Local\bin)
set "UserBin=%LOCALAPPDATA%\bin"
if NOT exist "%UserBin%" mkdir "%UserBin%"

:: 5️⃣ Write the wrapper – it simply runs “node <absolute path to nanoai.js> …”
(
    echo @echo off
    echo set "SCRIPT=%NanoSource%"
    echo node "!SCRIPT!" %%*
) > "%UserBin%\nanoai.cmd"

echo Installed NanoAI wrapper to: %UserBin%\nanoai.cmd

:: 6️⃣ Add the folder to the user PATH (if it isn’t already there)
set "CurPath=%PATH%"
echo !CurPath! | find /i "%UserBin%" >nul
if ERRORLEVEL 1 (
    echo Adding "%UserBin%" to your user %PATH%
    setx PATH "!CurPath!;%UserBin%" >nul
    echo ✅ Updated PATH. Please restart any open command windows.
) else (
    echo ✓ "%UserBin%" already in your user %PATH%.
)

:: 7️⃣ Update the current console’s PATH so you can run nanoai immediately
set "PATH=%PATH%;%UserBin%"
echo Current PATH updated for this session.

endlocal