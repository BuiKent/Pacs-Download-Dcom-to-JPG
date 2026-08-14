from pathlib import Path
import json,re
root=Path(__file__).parents[1]
m=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
assert (root/'onboarding.html').exists() and (root/'onboarding.js').exists()
assert 'debugger' not in m.get('permissions',[])
assert 'downloads' in m.get('permissions',[])
assert 'unlimitedStorage' not in m.get('permissions',[])
assert not m.get('host_permissions')
assert m.get('optional_host_permissions')==['http://*/*','https://*/*']
bg=(root/'background.js').read_text(encoding='utf-8')
assert 'chrome.debugger' not in bg
# chrome.downloads phải nằm ở service worker: offscreen document chỉ được dùng
# chrome.runtime, gọi chrome.downloads bên đó là undefined.
assert 'chrome.downloads' in bg
# ...và chỉ nhận blob đã tải xong, không đưa URL của PACS cho Download Manager.
assert "startsWith('blob:')" in bg
assert "matchingAdapters" in bg and "adapterById" in bg
off=(root/'offscreen.js').read_text(encoding='utf-8')
assert 'createWritable' in off
assert 'parallelOrdered' in off
assert 'ENGINE_FINISHED' in off and 'ENGINE_FINISHED' in bg
# Quet phan CODE (bo dong comment) — offscreen document chi truy cap duoc
# chrome.runtime; moi chrome.* khac deu undefined o day.
off_code = '\n'.join(l for l in off.splitlines() if not l.lstrip().startswith('//'))
off_apis = sorted({m.group(1) for m in re.finditer(r'chrome\.([a-zA-Z]+)', off_code)})
assert off_apis == ['runtime'], f'offscreen document chi dung duoc chrome.runtime, dang dung: {off_apis}'
assert 'writeViaDownloads' in off and 'new Blob' in off
assert 'DOWNLOAD_BLOB' in off and 'DOWNLOAD_BLOB' in bg
assert 'prepareTask' in off and 'validatePart10' in off
assert 'chrome.debugger' not in off
assert 'RECIPES_KEY' in bg and 'ENGINE_LEARNED_URL' in bg
assert 'START_LEARNING' in bg and 'LEARN_CANDIDATE' in bg and 'materializeLearnedManifest' in bg
assert "s.tracking!=='watching'" in bg
# "Dung theo doi" la lenh dut khoat cua nguoi dung: tab da dung thi khong ghi
# gi nua, ke ca URL trong dung la PACS.
assert bg.count("s.tracking==='stopped')return") >= 2, 'webRequest phai ton trong trang thai stopped'
assert 'PROBE_DICOM_URLS' in bg and 'PROBE_DICOM_URLS' in off
assert 'binaryCandidates' in bg
ui=(root/'sidepanel.html').read_text(encoding='utf-8')+ (root/'sidepanel.js').read_text(encoding='utf-8')
assert "startIn:'downloads'" in ui and "id:'pacs-dicom'" in ui
assert 'learnToggleBtn' in ui and 'learnList' in ui
for bad in ['MVP','AI generated','Local only.']:
    assert bad not in ui

# Moi id ma sidepanel.js dung phai ton tai trong sidepanel.html - go bo hoac doi
# ten mot phan tu la panel vo ngay ($(...) tra null) ma khong bao gi.
html_src = (root/'sidepanel.html').read_text(encoding='utf-8')
js_src = (root/'sidepanel.js').read_text(encoding='utf-8')
html_ids = set(re.findall(r'id="([A-Za-z0-9_-]+)"', html_src))
js_ids = set(re.findall(r"\$\('([A-Za-z0-9_-]+)'\)", js_src)) | set(re.findall(r"show\('([A-Za-z0-9_-]+)'", js_src))
missing = sorted(js_ids - html_ids)
assert not missing, f'sidepanel.js dung id khong co trong sidepanel.html: {missing}'

# Cac trang thai ket qua phai phan biet duoc trong lich su va tren the ket qua.
for status in ['partial', 'done_with_errors', 'error', 'cancelled']:
    assert status in js_src, f'thieu trang thai {status} trong sidepanel.js'
assert 'previousDownload:row' in bg, 'finalizeJob phai gan ket qua vao inventory de panel doi trang thai ngay'
# GE ZFP: moc WebSocket phai chay o MAIN world tu document_start, va offscreen
# phai co duong dung DICOM tu pixel tho (khong co URL nao de fetch).
assert (root/'zfp-hook.js').exists()
hook = (root/'zfp-hook.js').read_text(encoding='utf-8')
assert "world:'MAIN'" in bg and "runAt:'document_start'" in bg
# Server ZFP tu choi 100% lenh xin anh gui tu ngoai (da do tren ca that: dung
# socket cua trang, dung payload, correlationId UUID - van cam). Moc phai HUNG
# anh viewer tu nap, tuyet doi khong gui lenh len socket anh nua.
hook_code = '\n'.join(l for l in hook.splitlines()
                      if not l.lstrip().startswith(('//', '/*', '*')))
assert 'GET_DICOM_IMAGE' not in hook_code, 'moc ZFP phai hung anh, khong duoc gui lenh xin anh'
assert 'watchImages' in hook and 'MAX_QUEUE_BYTES' in hook
assert 'zfp-image' in off and 'zfpMetaToDicomJson' in off
# Engine ZFP la vong DAY (hung) chu khong keo theo task nhu cac adapter khac.
assert 'runZfpJob' in off and 'ZFP_TAKE_REQUEST' in off and 'ZFP_TAKE_REQUEST' in bg
assert 'ZFP_RELOAD_REQUEST' in off and 'ZFP_RELOAD_REQUEST' in bg
assert "ZFP_TAKE:'take'" in (root/'content.js').read_text(encoding='utf-8')

print('Static architecture checks OK')
