from pathlib import Path
import json,re
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

# ---------------------------------------------------------------------------
# Architecture invariants maintained from v6.2.
# ---------------------------------------------------------------------------
content=(root/'content.js').read_text(encoding='utf-8')
hook=(root/'zfp-hook.js').read_text(encoding='utf-8')

# Minimum permissions: only request permissions actively needed.
assert 'downloads' in m.get('permissions',[])
assert 'unlimitedStorage' not in m.get('permissions',[])
assert (root/'onboarding.html').exists() and (root/'onboarding.js').exists()

# Offscreen document can ONLY access chrome.runtime.
off_code='\n'.join(l for l in off.splitlines() if not l.lstrip().startswith('//'))
off_apis=sorted({x.group(1) for x in re.finditer(r'chrome\.([a-zA-Z]+)',off_code)})
assert off_apis==['runtime'], f'offscreen can only use chrome.runtime, currently using: {off_apis}'
assert 'chrome.downloads' in bg, 'chrome.downloads must be in service worker'

# Received DICOM bytes must have UID cross-referenced against task before writing.
assert 'dicomTaskIdentityError' in off
assert 'adapterInventories' in bg and 'tasksBelongToStudy' in bg
assert 'attemptId' in bg and 'attemptId' in off
assert 'cumulativeAttemptCounters' in bg, 'subsequent attempt progress must add onto logical baseline job'
assert 'ENGINE_FINISHED' in off and 'ENGINE_FINISHED' in bg
assert 'DOWNLOAD_BLOB' in off and 'DOWNLOAD_BLOB' in bg
assert 'PROBE_DICOM_URLS' in bg and 'PROBE_DICOM_URLS' in off
assert 'parallelOrdered' in off
assert "from './lib/orchestrator.js'" in bg and "from './lib/semaphore.js'" in off
assert 'previousDownload:row' in bg, 'finalizeJob must assign result to inventory for immediate panel status change'

# Stopped tracking must strictly halt request logging.
assert "s.tracking!=='watching'" in bg
assert bg.count("s.tracking==='stopped')return")>=2, 'webRequest must respect stopped tracking state'
assert 'RECIPES_KEY' in bg and 'ENGINE_LEARNED_URL' in bg
assert 'START_LEARNING' in bg and 'LEARN_CANDIDATE' in bg and 'materializeLearnedManifest' in bg
assert 'learnToggleBtn' in ui and 'learnList' in ui

# GE ZFP: hook runs in MAIN world at document_start.
assert "world:'MAIN'" in bg and "runAt:'document_start'" in bg
hook_code='\n'.join(l for l in hook.splitlines() if not l.lstrip().startswith(('//','/*','*')))
assert 'GET_DICOM_IMAGE' not in hook_code, 'ZFP hook must capture streaming images without external fetch'
assert 'watchImages' in hook and 'MAX_QUEUE_BYTES' in hook
assert 'runZfpJob' in off and 'ZFP_TAKE_REQUEST' in off and 'ZFP_TAKE_REQUEST' in bg
assert 'ZFP_RELOAD_REQUEST' in off and 'ZFP_RELOAD_REQUEST' in bg
assert "ZFP_TAKE:'take'" in content

# Every id used by sidepanel.js must exist in sidepanel.html.
html_src=(root/'sidepanel.html').read_text(encoding='utf-8')
js_src=(root/'sidepanel.js').read_text(encoding='utf-8')
html_ids=set(re.findall(r'id="([A-Za-z0-9_-]+)"',html_src))
js_ids=set(re.findall(r"\$\('([A-Za-z0-9_-]+)'\)",js_src))|set(re.findall(r"show\('([A-Za-z0-9_-]+)'",js_src))
missing=sorted(js_ids-html_ids)
assert not missing, f'sidepanel.js uses ids not in sidepanel.html: {missing}'
for status in ['partial','done_with_errors','error','cancelled']:
    assert status in js_src, f'missing status {status} in sidepanel.js'
for bad in ['MVP','AI generated','Local only.']:
    assert bad not in ui

# Recipe link structure keying.
assert 'function recipeKeyForUrl(' in bg
assert bg.count('computeUrlFingerprint(')==1, \
    'computeUrlFingerprint must only be called in recipeKeyForUrl'
assert 'getPreferredAdapter' in bg and 'getPreferredRoutes' in bg
assert 'orderRoutes' in off, 'engine must run routes in learned order'
assert 'preferredRoutes' in off, 'engine must report winning routes'

# QIDO-RS pagination.
assert 'fetchQidoPaged' in (root/'lib/adapters/dicomweb.js').read_text(encoding='utf-8')
assert 'limit=100000' not in (root/'lib/adapters/dicomweb.js').read_text(encoding='utf-8'), \
    'must use real pagination instead of oversized limit'

# Compressed frames without transfer syntax must reject instead of guessing.
dicom_lib=(root/'lib/dicom.js').read_text(encoding='utf-8')
assert 'FRAME_TS_BY_MEDIA_TYPE' in dicom_lib
assert "if(!sourceTs)throw new Error" in dicom_lib

print('Static architecture checks OK')

