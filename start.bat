@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

set "SETTINGS_FILE=.server_console_settings.bat"
set "PORT=3000"
set "AUTO_OPEN_BROWSER=0"
set "PYTHON_CMD=py"
if exist ".venv\Scripts\python.exe" (
	set "PYTHON_CMD=.venv\Scripts\python.exe"
)

if exist "%SETTINGS_FILE%" (
	call "%SETTINGS_FILE%"
)

:menu
echo.
echo ==================================
echo   BlockWorld Server Console
echo ==================================
echo Current settings: PORT=!PORT! ^| PYTHON=!PYTHON_CMD!
echo [0] Install Requirements
echo [1] Start Server ^(same console^)
echo [2] Stop Server ^(configured port^)
echo [3] Server Status
echo [4] Open Game URL
echo [5] Settings
echo [Q] Quit Console
echo.
choice /c 012345Q /n /m "Select option: "

if errorlevel 7 goto quit
if errorlevel 6 goto settings_menu
if errorlevel 5 goto open_game
if errorlevel 4 goto status
if errorlevel 3 goto stop_server
if errorlevel 2 goto start_server
if errorlevel 1 goto install_requirements

goto menu

:install_requirements
echo.
echo Installing Python requirements...
"%PYTHON_CMD%" -m pip install -r requirements.txt
if errorlevel 1 (
	echo Install failed.
) else (
	echo Install complete.
)
echo.
pause
goto menu

:start_server
echo.
echo Starting server on port !PORT! in this console...
echo Press Ctrl+C to stop and return here.
echo ----------------------------------
if "!AUTO_OPEN_BROWSER!"=="1" (
	start "" "http://localhost:!PORT!"
)
"%PYTHON_CMD%" app.py
set "SERVER_EXIT=%ERRORLEVEL%"
echo ----------------------------------
echo Server exited with code !SERVER_EXIT!.
echo.
pause
goto menu

:stop_server
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":!PORT! .*LISTENING"') do (
	taskkill /PID %%P /T /F >nul 2>&1
	echo Stopped PID %%P
)
goto menu

:status
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":!PORT! .*LISTENING"') do (
	echo Server is RUNNING on port !PORT!. PID: %%P
	goto menu
)

	echo Server is STOPPED.
goto menu

:stop_server_silent
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":!PORT! .*LISTENING"') do (
	taskkill /PID %%P /T /F >nul 2>&1
)
	exit /b 0


:open_game
	start "" "http://localhost:!PORT!"
	goto menu

:settings_menu
echo.
echo -------- Settings --------
echo [1] Set Port ^(current: !PORT!^)
echo [2] Set Python Command ^(current: !PYTHON_CMD!^)
echo [3] Toggle Auto-Open Browser On Start ^(current: !AUTO_OPEN_BROWSER!^)
echo [4] Save Settings
echo [B] Back
choice /c 1234B /n /m "Select setting: "

if errorlevel 5 goto menu
if errorlevel 4 goto save_settings
if errorlevel 3 goto toggle_auto_open
if errorlevel 2 goto set_python
if errorlevel 1 goto set_port
goto settings_menu

:set_port
echo.
set "NEW_PORT="
set /p "NEW_PORT=Enter port (1-65535): "

set "INVALID_PORT="
if not defined NEW_PORT set "INVALID_PORT=1"
for /f "delims=0123456789" %%A in ("!NEW_PORT!") do set "INVALID_PORT=1"

if defined INVALID_PORT (
	echo Invalid port.
	pause
	goto settings_menu
)

set /a PORT_NUM=!NEW_PORT! >nul 2>&1
if !PORT_NUM! LSS 1 set "INVALID_PORT=1"
if !PORT_NUM! GTR 65535 set "INVALID_PORT=1"

if defined INVALID_PORT (
	echo Invalid port.
	pause
	goto settings_menu
)

set "PORT=!PORT_NUM!"
echo Port set to !PORT!.
pause
goto settings_menu

:set_python
echo.
set "NEW_PYTHON_CMD="
set /p "NEW_PYTHON_CMD=Enter Python command/path: "
if not defined NEW_PYTHON_CMD (
	echo Python command cannot be empty.
	pause
	goto settings_menu
)

set "PYTHON_CMD=!NEW_PYTHON_CMD!"
echo Python command set to !PYTHON_CMD!.
pause
goto settings_menu

:toggle_auto_open
if "!AUTO_OPEN_BROWSER!"=="1" (
	set "AUTO_OPEN_BROWSER=0"
) else (
	set "AUTO_OPEN_BROWSER=1"
)
echo Auto-open browser is now !AUTO_OPEN_BROWSER!.
pause
goto settings_menu

:save_settings
(
	echo set "PORT=!PORT!"
	echo set "PYTHON_CMD=!PYTHON_CMD!"
	echo set "AUTO_OPEN_BROWSER=!AUTO_OPEN_BROWSER!"
) > "%SETTINGS_FILE%"
echo Settings saved to %SETTINGS_FILE%.
pause
goto settings_menu

:quit
	echo Exiting console.
	exit /b 0
