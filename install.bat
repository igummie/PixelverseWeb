@echo off
:: Activate the virtual environment
call .venv\Scripts\activate
setlocal
cd /d "%~dp0"
echo Installing Python dependencies...
py -m pip install -r requirements.txt
if errorlevel 1 (
  echo.
  echo Install failed.
  exit /b 1
)
echo.
echo Install complete.
