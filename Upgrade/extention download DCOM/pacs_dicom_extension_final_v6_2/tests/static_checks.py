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
assert 'PROBE_DICOM_URLS' in bg and 'PROBE_DICOM_URLS' in off
assert 'binaryCandidates' in bg
ui=(root/'sidepanel.html').read_text(encoding='utf-8')+ (root/'sidepanel.js').read_text(encoding='utf-8')
assert "startIn:'downloads'" in ui and "id:'pacs-dicom'" in ui
assert 'learnToggleBtn' in ui and 'learnList' in ui
for bad in ['MVP','AI generated','Local only.']:
    assert bad not in ui
print('Static architecture checks OK')
