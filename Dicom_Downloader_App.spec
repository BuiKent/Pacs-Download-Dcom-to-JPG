# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all, collect_data_files

datas = []
binaries = []
hiddenimports = []
for pkg in ['playwright', 'pylibjpeg', 'libjpeg', 'openjpeg', 'rle']:
    tmp_ret = collect_all(pkg)
    datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
datas += collect_data_files('webview')
hiddenimports += [
    'webview.platforms.edgechromium',
    'webview.platforms.winforms',
    'pythonnet',
    'clr_loader',
    'pylibjpeg.plugins',
]
datas += [('web_dist', 'web_dist')]
import os
if os.path.exists('tools/bin'):
    datas += [('tools/bin', 'tools/bin')]


a = Analysis(
    ['dcom_web_app.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # pydicom's official PyInstaller hook includes its dictionaries and pixel
    # handlers.  Do not collect-all pydicom: that also drags optional CLI/data
    # science stacks (pandas/pyarrow/openpyxl) into this small desktop viewer.
    excludes=['pandas', 'pyarrow', 'openpyxl', 'lxml', 'matplotlib', 'scipy'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='Dicom_Downloader_App',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
