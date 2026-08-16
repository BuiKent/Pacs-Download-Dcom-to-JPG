import {replayContentType, bodyLooksJson} from '../lib/pacs.js';

const URL_MANIFEST = 'https://vietmy.pmr.vn/WS/ws.asmx/GetListImageFileInfo';
const JSON_BODY = new TextEncoder().encode("{'caseStudyId':560541, 'sToken':'abc'}");
const FORM_BODY = new TextEncoder().encode('data=1&transport=longPolling');
const isJson = ct => /application\/json/i.test(ct);

if (!bodyLooksJson(JSON_BODY)) throw new Error('JSON body must be recognized');
if (bodyLooksJson(FORM_BODY)) throw new Error('Form body must not be treated as JSON');

// Exact Content-Type recorded for the request always takes precedence.
if (replayContentType({headersByOrigin:{'https://vietmy.pmr.vn':{'Content-Type':'text/plain'}}},
                      URL_MANIFEST, {contentType:'application/json; charset=UTF-8'}, JSON_BODY)
    !== 'application/json; charset=UTF-8') throw new Error('Must prioritize request contentType');

// When no header is recorded, infer from body.
if (!isJson(replayContentType({}, URL_MANIFEST, {method:'POST'}, JSON_BODY)))
  throw new Error('JSON body without headers must default to application/json');

// Origin-wide headers from other requests must not override JSON manifest.
if (!isJson(replayContentType({headersByOrigin:{'https://vietmy.pmr.vn':{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'}}},
                              URL_MANIFEST, {method:'POST'}, JSON_BODY)))
  throw new Error('Content-Type from another request must not override JSON manifest');

// Non-JSON bodies retain origin headers.
if (replayContentType({headersByOrigin:{'https://x.test':{'Content-Type':'application/x-www-form-urlencoded'}}},
                      'https://x.test/api/list', {method:'POST'}, FORM_BODY)
    !== 'application/x-www-form-urlencoded') throw new Error('Form body must preserve default behavior');

console.log('Replay Content-Type tests OK');

