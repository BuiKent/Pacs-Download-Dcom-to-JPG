from pathlib import Path
import json
root=Path(__file__).parents[1]
m=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
assert m['version'].startswith('7.')
assert 'debugger' not in m.get('permissions',[])
assert not m.get('host_permissions')
assert m.get('optional_host_permissions')==['http://*/*','https://*/*']
assert (root/'generic-hook.js').exists() and (root/'lib/generic_discovery.js').exists()
bg=(root/'background.js').read_text(encoding='utf-8')
off=(root/'offscreen.js').read_text(encoding='utf-8')
sem=(root/'lib/semaphore.js').read_text(encoding='utf-8')
generic=(root/'lib/adapters/generic.js').read_text(encoding='utf-8')
assert 'chrome.debugger' not in bg+off
assert 'matchingAdapters' in bg and 'adapterById' in bg
assert 'processGenericManifestPayload' in bg and 'extractManifestCandidates' in bg
assert 'GENERIC_JSON_CAPTURE' in bg and 'generic-hook.js' in bg
assert 'INSPECT_DICOM_URLS' in bg and 'INSPECT_DICOM_URLS' in off
assert 'genericEntries' in bg and 'genericEntries' in generic
assert 'requestBody' in generic and "method:String(e.method||'GET')" in generic
assert 'storedBodySignature' in bg and 'requestId' in bg and 'genericEntryKey' in bg
assert 'requestMetaForObserved' in bg and 'GENERIC_JSON_CAPTURE' in bg
assert "body: ['GET','HEAD'].includes(method) ? undefined : task?.body" in sem
assert 'decodeRequestBody' in off and 'requestTask' in off
assert 'createWritable' in off and 'validatePart10' in off
assert 'writeViaDownloads' in off and 'new Blob' in off
# Download Manager may save validated Blob only; PACS URL must never be passed directly.
assert "if(!String(url||'').startsWith('blob:'))" in bg
assert 'RecipeStoreV2' in bg and 'manifestRecipes' in bg
assert 'zfp-hook.js' in bg and (root/'zfp-hook.js').exists()
ui=(root/'sidepanel.html').read_text(encoding='utf-8')+(root/'sidepanel.js').read_text(encoding='utf-8')
assert "startIn:'downloads'" in ui and "id:'pacs-dicom'" in ui
print('Static architecture checks OK')
