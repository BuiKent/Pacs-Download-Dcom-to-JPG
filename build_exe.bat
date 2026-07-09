@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================================
echo   DONG GOI Dicom_Downloader_App.exe
echo ============================================================
echo.
echo [1/2] Cai/nang cap PyInstaller...
python -m pip install --upgrade pyinstaller
echo.
echo [2/2] Dang dong goi (vai phut, dung tat cua so)...
python -m PyInstaller --noconfirm --onefile --noconsole ^
  --name Dicom_Downloader_App ^
  --collect-all playwright ^
  --collect-all pydicom ^
  dcom_downloader_app.py
echo.
if exist "dist\Dicom_Downloader_App.exe" (
  echo XONG. File nam o:  dist\Dicom_Downloader_App.exe
  echo Luu y: lan bam "BAT DAU TAI" dau tien tren may moi se tu tai Chromium ~150MB.
) else (
  echo Dong goi that bai. Xem thong bao loi ben tren.
)
pause
