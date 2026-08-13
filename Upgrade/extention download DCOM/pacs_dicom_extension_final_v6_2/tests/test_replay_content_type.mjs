import {replayContentType, bodyLooksJson} from '../lib/pacs.js';

const URL_MANIFEST = 'https://vietmy.pmr.vn/WS/ws.asmx/GetListImageFileInfo';
const JSON_BODY = new TextEncoder().encode("{'caseStudyId':560541, 'sToken':'abc'}");
const FORM_BODY = new TextEncoder().encode('data=1&transport=longPolling');
const isJson = ct => /application\/json/i.test(ct);

if (!bodyLooksJson(JSON_BODY)) throw new Error('body JSON phải được nhận ra');
if (bodyLooksJson(FORM_BODY)) throw new Error('body dạng form không được coi là JSON');

// Kiểu ghi được của chính request đó luôn thắng.
if (replayContentType({headersByOrigin:{'https://vietmy.pmr.vn':{'Content-Type':'text/plain'}}},
                      URL_MANIFEST, {contentType:'application/json; charset=UTF-8'}, JSON_BODY)
    !== 'application/json; charset=UTF-8') throw new Error('phải ưu tiên contentType của request');

// Không ghi được gì thì suy từ body — đây là ca extension hay gặp nhất.
if (!isJson(replayContentType({}, URL_MANIFEST, {method:'POST'}, JSON_BODY)))
  throw new Error('body JSON mà thiếu header thì phải tự gửi application/json');

// Ô header dùng chung của origin bị request khác đè lên KHÔNG được làm hỏng
// việc phát lại manifest JSON — đây chính là lỗi khiến VietMy không tải được.
if (!isJson(replayContentType({headersByOrigin:{'https://vietmy.pmr.vn':{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'}}},
                              URL_MANIFEST, {method:'POST'}, JSON_BODY)))
  throw new Error('content-type của request khác không được đè lên manifest JSON');

// Body không phải JSON thì vẫn dùng kiểu chung của origin như trước (PACS khác).
if (replayContentType({headersByOrigin:{'https://x.test':{'Content-Type':'application/x-www-form-urlencoded'}}},
                      'https://x.test/api/list', {method:'POST'}, FORM_BODY)
    !== 'application/x-www-form-urlencoded') throw new Error('body form phải giữ hành vi cũ');

console.log('Replay Content-Type tests OK');
