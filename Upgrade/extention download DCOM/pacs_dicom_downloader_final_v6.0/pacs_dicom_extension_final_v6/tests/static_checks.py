from pathlib import Path
import json,re
root=Path(__file__).parents[1]
m=json.loads((root/'manifest.json').read_text())
assert 'debugger' not in m.get('permissions',[])
assert 'downloads' not in m.get('permissions',[])
assert 'unlimitedStorage' not in m.get('permissions',[])
assert not m.get('host_permissions')
assert m.get('optional_host_permissions')==['http://*/*','https://*/*']
bg=(root/'background.js').read_text()
assert 'chrome.debugger' not in bg
assert 'chrome.downloads' not in bg
assert "matchingAdapters" in bg and "adapterById" in bg
off=(root/'offscreen.js').read_text()
assert 'createWritable' in off
assert 'parallelOrdered' in off
assert 'ENGINE_FINISHED' in off and 'ENGINE_FINISHED' in bg
assert 'chrome.downloads' not in off
assert 'chrome.debugger' not in off
assert 'RECIPES_KEY' in bg and 'ENGINE_LEARNED_URL' in bg
assert 'PROBE_DICOM_URLS' in bg and 'PROBE_DICOM_URLS' in off
assert 'binaryCandidates' in bg
ui=(root/'sidepanel.html').read_text()+ (root/'sidepanel.js').read_text()
for bad in ['MVP','AI generated','Local only.']:
    assert bad not in ui
print('Static architecture checks OK')
