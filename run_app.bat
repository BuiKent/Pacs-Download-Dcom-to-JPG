@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Dang khoi dong ung dung...
python dcom_downloader_app.py
if errorlevel 1 (
  echo.
  echo Co loi xay ra. Kiem tra da cai Python va cac thu vien chua:
  echo    pip install playwright pydicom pillow numpy
  echo    python -m playwright install chromium
  pause
)
