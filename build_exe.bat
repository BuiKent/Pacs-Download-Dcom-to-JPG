@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================================
echo   DONG GOI DCom JPG PACS v1.1
echo ============================================================
echo.
echo [1/3] Build giao dien Cornerstone offline...
pushd webui
call npm install
if errorlevel 1 goto :failed
call npm run build
if errorlevel 1 goto :failed
popd
echo.
if exist ".venv\Scripts\python.exe" (
  set "PY_CMD=.venv\Scripts\python.exe"
) else (
  set "PY_CMD=python"
)

echo [2/3] Cai/nang cap dependency Python...
%PY_CMD% -m pip install -r requirements.txt
%PY_CMD% -m pip install --upgrade pyinstaller
if errorlevel 1 goto :failed
echo.
echo [3/3] Dong goi EXE (vai phut, dung tat cua so)...
%PY_CMD% -m PyInstaller --noconfirm Dicom_Downloader_App.spec
if errorlevel 1 goto :failed
echo.
if exist "dist\Dicom_Downloader_App.exe" (
  echo XONG. File nam o: dist\Dicom_Downloader_App.exe
  echo UI dung WebView2 co san tren Windows. Neu may thieu WebView2, app tu mo UI Tk cu.
) else (
  goto :failed
)
pause
exit /b 0

:failed
popd 2>nul
echo.
echo DONG GOI THAT BAI. Xem thong bao loi ben tren.
pause
exit /b 1
