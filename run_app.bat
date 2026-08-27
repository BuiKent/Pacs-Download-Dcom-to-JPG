@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  set "PY_CMD=.venv\Scripts\python.exe"
) else (
  set "PY_CMD=python"
)
%PY_CMD% dcom_web_app.py
if errorlevel 1 (
  echo.
  echo Co loi xay ra. Kiem tra da cai Python va cac thu vien chua:
  echo    pip install -r requirements.txt
  echo    python -m playwright install chromium
  pause
)
