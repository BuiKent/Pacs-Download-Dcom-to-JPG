/**
 * Reconstruct POST manifest when the extension did not capture the original request in time.
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

// 1. No prior record -> reconstruct POST with correct caseStudyId/sToken.
{
  const ctx=makeCtx();
  const inv=await VietmyAdapter.analyze(ctx);
  const meta=ctx.seen.meta;
  if(meta.method!=='POST')throw new Error(`Must reconstruct using POST, got ${meta.method}`);
  if(!/application\/json/i.test(meta.contentType||''))throw new Error('Must send JSON Content-Type');
  const body=JSON.parse(decode(meta));
  if(body.caseStudyId!==560541)throw new Error(`Wrong caseStudyId: ${body.caseStudyId}`);
  if(body.sToken!=='6a6abe7e749dee3bdcdaadf5')throw new Error(`Wrong sToken: ${body.sToken}`);
  if(inv.patient.name!=='NGUYEN THI VAN')throw new Error('Unable to read patient name');
}

// 2. Real record present -> use recorded request without synthesizing.
{
  const recorded={type:'VIETMY_MANIFEST',url:MANIFEST,method:'POST',contentType:'application/json',
                  requestBody:{kind:'raw',chunks:[Buffer.from('{"caseStudyId":999}').toString('base64')]}};
  const ctx=makeCtx({recorded});
  await VietmyAdapter.analyze(ctx);
  if(JSON.parse(decode(ctx.seen.meta)).caseStudyId!==999)throw new Error('Must prioritize recorded request');
}

// 3. Missing caseStudyId -> report clear error without trying GET.
{
  const ctx=makeCtx({studyId:''});
  let msg='';
  try{await VietmyAdapter.analyze(ctx);}catch(e){msg=e.message;}
  if(!/VietMy manifest request not captured/i.test(msg))throw new Error(`Unclear error message: "${msg}"`);
  if(ctx.seen.meta)throw new Error('Should not make network call when bound to fail');
}

// 4. Missing token in URL -> report clear error.
{
  const ctx=makeCtx({currentUrl:'https://vietmy.pmr.vn/Pages/ShareStudy.aspx'});
  let threw=false;
  try{await VietmyAdapter.analyze(ctx);}catch{threw=true;}
  if(!threw)throw new Error('Missing sToken but execution did not throw');
}

console.log('VietMy manifest rebuild tests OK');

