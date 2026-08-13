/**
 * Dựng lại POST manifest khi extension chưa kịp ghi request gốc.
 *
 * webRequest chỉ ghi method/body lúc tab đang được theo dõi, mà viewer gọi
 * manifest ngay khi mở trang — bật extension sau là mất. Endpoint ASMX trả
 * trang HTML kèm HTTP 200 nếu gọi bằng GET, nên phải dựng lại đúng POST.
 */
import { VietmyAdapter } from '../lib/adapters/vietmy.js';

const MANIFEST='https://vietmy.pmr.vn/WS/ws.asmx/GetListImageFileInfo';
const SHARE='https://vietmy.pmr.vn/Pages/ShareStudy.aspx?stoken=6a6abe7e749dee3bdcdaadf5';
const IFRAME='https://vietmy.pmr.vn/Pages/PacsViewer.aspx?shared=true&v=83e088de';

const PAYLOAD={d:{patientName:'NGUYEN THI VAN',patientId:'BG20260730-188',studyDate:'20260730',
  studyUID:'1.2.392.1',seriesList:[{seriesUID:'1.2.392.1.7',seriesNumber:'7',seriesDescription:'T2 SAG',
  modality:['MR'],fileList:[{instanceNo:'1',filePath:`https://vietmy.pmr.vn/ws/getfile.ashx?fileId=1&stoken=abc`}]}]}};

function makeCtx({recorded=null,studyId='560541',currentUrl=SHARE}={}){
  const seen={};
  return {
    seen,
    state:{headersByOrigin:{},pacsRequests:recorded?[recorded]:[]},
    summary:{requests:[{type:'VIETMY_MANIFEST',url:MANIFEST,score:120}],currentUrl,
             bestViewerUrl:IFRAME,frameUrls:[currentUrl,IFRAME],navUrls:[currentUrl],
             detector:'VIETMY',vietmyStudyId:studyId},
    async fetchJson(url,accept,meta){seen.meta=meta;return PAYLOAD;},
    headersForUrl:()=>({}),
    inheritQuery:(t)=>t,
    normalizeStudy:x=>x,
  };
}
const decode=meta=>Buffer.from(meta.requestBody.chunks[0],'base64').toString('utf8');

// 1. Không có bản ghi nào -> dựng lại POST đúng caseStudyId/sToken.
{
  const ctx=makeCtx();
  const inv=await VietmyAdapter.analyze(ctx);
  const meta=ctx.seen.meta;
  if(meta.method!=='POST')throw new Error(`phải dựng lại bằng POST, đang là ${meta.method}`);
  if(!/application\/json/i.test(meta.contentType||''))throw new Error('phải gửi Content-Type JSON');
  const body=JSON.parse(decode(meta));
  if(body.caseStudyId!==560541)throw new Error(`caseStudyId sai: ${body.caseStudyId}`);
  if(body.sToken!=='6a6abe7e749dee3bdcdaadf5')throw new Error(`sToken sai: ${body.sToken}`);
  if(inv.patient.name!=='NGUYEN THI VAN')throw new Error('không đọc được bệnh nhân');
}

// 2. Có bản ghi thật thì phải dùng bản ghi, không tự bịa.
{
  const recorded={type:'VIETMY_MANIFEST',url:MANIFEST,method:'POST',contentType:'application/json',
                  requestBody:{kind:'raw',chunks:[Buffer.from('{"caseStudyId":999}').toString('base64')]}};
  const ctx=makeCtx({recorded});
  await VietmyAdapter.analyze(ctx);
  if(JSON.parse(decode(ctx.seen.meta)).caseStudyId!==999)throw new Error('phải ưu tiên request đã ghi được');
}

// 3. Thiếu caseStudyId -> báo lỗi rõ, KHÔNG được thử GET (GET luôn trả HTML).
{
  const ctx=makeCtx({studyId:''});
  let msg='';
  try{await VietmyAdapter.analyze(ctx);}catch(e){msg=e.message;}
  if(!/Chưa ghi được request manifest/.test(msg))throw new Error(`thông báo lỗi chưa rõ: "${msg}"`);
  if(ctx.seen.meta)throw new Error('không được gọi mạng khi biết chắc sẽ hỏng');
}

// 4. Thiếu token trên URL -> cũng phải báo lỗi, không phát request cụt.
{
  const ctx=makeCtx({currentUrl:'https://vietmy.pmr.vn/Pages/ShareStudy.aspx'});
  let threw=false;
  try{await VietmyAdapter.analyze(ctx);}catch{threw=true;}
  if(!threw)throw new Error('thiếu sToken mà vẫn chạy tiếp');
}

console.log('VietMy manifest rebuild tests OK');
