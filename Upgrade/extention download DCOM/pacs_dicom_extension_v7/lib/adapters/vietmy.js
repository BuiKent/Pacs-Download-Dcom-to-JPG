'use strict';
import { bestDetectedRequest, normalizeSeries, seriesFolderName, sanitizeSegment } from '../pacs.js';

function normKey(key){return String(key||'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function ownMap(obj){const m=new Map();if(!obj||typeof obj!=='object'||Array.isArray(obj))return m;for(const [k,v] of Object.entries(obj))m.set(normKey(k),v);return m;}
function pick(obj,aliases){const m=ownMap(obj);for(const a of aliases){const v=m.get(normKey(a));if(v!==undefined&&v!==null&&v!=='')return v;}return '';}
function text(v){return v===undefined||v===null?'':String(v).trim();}

function unwrapAsmx(payload){
  let v=payload;
  for(let i=0;i<5;i++){
    if(v&&typeof v==='object'&&!Array.isArray(v)&&Object.prototype.hasOwnProperty.call(v,'d')){v=v.d;continue;}
    if(typeof v==='string'){
      const s=v.trim();
      if((s.startsWith('{')&&s.endsWith('}'))||(s.startsWith('[')&&s.endsWith(']'))){try{v=JSON.parse(s);continue;}catch{}}
    }
    break;
  }
  return v;
}

function mergeContext(base,obj){
  const c={...base};
  const set=(key,aliases)=>{const v=text(pick(obj,aliases));if(v)c[key]=v;};
  set('patientName',['PatientName','PatName','PatientFullName','FullName']);
  set('patientId',['PatientID','PatientId','PatID','PatientCode','PatientNo','MRN']);
  set('birthDate',['PatientBirthDate','BirthDate','DOB']);
  set('studyDate',['StudyDate','StudyDatetime','StudyDateTime','ExamDate','PerformedDate']);
  set('studyDescription',['StudyDescription','StudyDesc','StudyName','ExamName']);
  set('accession',['AccessionNumber','AccessionNo','Accession']);
  set('studyUid',['StudyInstanceUID','StudyUID','StuInsUID']);
  set('seriesUid',['SeriesInstanceUID','SeriesUID','SeriesInsUID']);
  set('seriesId',['SeriesID','SeriesId']);
  set('seriesNumber',['SeriesNumber','SeriesNo','SeriesNum']);
  set('seriesDescription',['SeriesDescription','SeriesDesc','SeriesName','SequenceName','ProtocolName']);
  set('modality',['Modality']);
  return c;
}

function parseVietmyManifest(payload,manifestUrl){
  const root=unwrapAsmx(payload),images=[],seen=new Set();let globalCtx={};
  function walk(v,ctx={},depth=0){
    if(depth>14||v==null)return;
    if(Array.isArray(v)){for(const x of v)walk(x,ctx,depth+1);return;}
    if(typeof v!=='object')return;
    const next=mergeContext(ctx,v);globalCtx=mergeContext(globalCtx,v);
    const filePath=text(pick(v,['filePath'])).replace(/&amp;/gi,'&');
    if(filePath){
      let url='';try{url=new URL(filePath,manifestUrl).href;}catch{}
      if(url&&!seen.has(url)){
        seen.add(url);
        images.push({
          filePath:url,
          seriesUid:next.seriesUid||'',seriesId:next.seriesId||'',seriesNumber:next.seriesNumber||'',seriesDescription:next.seriesDescription||'',modality:next.modality||'',
          sopInstanceUid:text(pick(v,['SOPInstanceUID','SOPUID','ImageUID','ObjectUID'])),
          instanceNumber:text(pick(v,['InstanceNumber','ImageNumber','ImageNo','ImageIndex','InstanceNo'])),
          studyUid:next.studyUid||'',patientName:next.patientName||'',patientId:next.patientId||'',birthDate:next.birthDate||'',studyDate:next.studyDate||'',studyDescription:next.studyDescription||'',accession:next.accession||''
        });
      }
    }
    for(const [k,x] of Object.entries(v)){
      const nk=normKey(k);if(nk==='filepath'||nk==='imagepath')continue;walk(x,next,depth+1);
    }
  }
  walk(root,{});
  if(!images.length)return{patient:{},studyUid:'',series:[],groups:[]};
  const patient={
    name:images.find(x=>x.patientName)?.patientName||globalCtx.patientName||'',
    id:images.find(x=>x.patientId)?.patientId||globalCtx.patientId||'',
    birthDate:images.find(x=>x.birthDate)?.birthDate||globalCtx.birthDate||'',
    studyDate:images.find(x=>x.studyDate)?.studyDate||globalCtx.studyDate||'',
    description:images.find(x=>x.studyDescription)?.studyDescription||globalCtx.studyDescription||'',
    accession:images.find(x=>x.accession)?.accession||globalCtx.accession||''
  };
  const studyUid=images.find(x=>x.studyUid)?.studyUid||globalCtx.studyUid||'';
  const map=new Map();
  for(const im of images){
    const key=im.seriesUid||im.seriesId||`${im.seriesNumber}|${im.seriesDescription}|${im.modality}`||'series';
    if(!map.has(key))map.set(key,{key,seriesUid:im.seriesUid||'',seriesId:im.seriesId||'',number:im.seriesNumber||'',description:im.seriesDescription||'',modality:im.modality||'',images:[]});
    map.get(key).images.push(im);
  }
  const groups=[...map.values()].sort((a,b)=>{const an=Number(a.number),bn=Number(b.number);if(Number.isFinite(an)&&Number.isFinite(bn)&&an!==bn)return an-bn;return String(a.description||a.key).localeCompare(String(b.description||b.key));});
  const series=groups.map((g,i)=>normalizeSeries({SeriesInstanceUID:g.seriesUid||g.seriesId,SeriesNumber:g.number,SeriesDescription:g.description,Modality:g.modality,ImageCount:g.images.length},'vietmy',i));
  groups.forEach((g,i)=>{g.choice=series[i];});
  return{patient,studyUid,series,groups};
}

function shareToken(summary){
  for(const raw of [summary?.currentUrl,summary?.bestViewerUrl,...(summary?.frameUrls||[]),...(summary?.navUrls||[])]){
    if(!raw)continue;
    try{
      const q=new URL(raw).searchParams;
      for(const key of ['stoken','sToken','token'])if(q.get(key))return q.get(key);
      // ShareStudy đôi khi dùng query không tên: ?<token>
      for(const [k,v] of q.entries())if(!k&&v)return v;
    }catch{}
  }
  return '';
}

/**
 * Dựng lại POST manifest khi extension chưa ghi được request gốc.
 *
 * `webRequest` chỉ ghi method/body lúc tab đang được theo dõi, mà viewer gọi
 * manifest ngay khi mở trang — bật extension sau là mất. Trước đây rơi vào cảnh
 * này là adapter phát lại bằng GET, ASMX trả trang HTML kèm HTTP 200 rồi hỏng.
 * Hai tham số nó cần đều lấy lại được: `sToken` trên URL chia sẻ, còn
 * `caseStudyId` nằm trong id thẻ series của DOM viewer.
 */
function rebuiltManifestMeta(ctx,url){
  const studyId=String(ctx.summary?.vietmyStudyId||'').trim(),token=shareToken(ctx.summary);
  if(!/^\d+$/.test(studyId)||!token)return null;
  const body=JSON.stringify({caseStudyId:Number(studyId),sToken:token});
  return{type:'VIETMY_MANIFEST',url,method:'POST',contentType:'application/json; charset=UTF-8',
         requestBody:{kind:'raw',chunks:[btoa(body)]}};
}

function requestMetaFor(ctx,url){
  const recorded=(ctx.state?.pacsRequests||[]).find(x=>x.type==='VIETMY_MANIFEST'&&x.url===url&&x.requestBody);
  return recorded||rebuiltManifestMeta(ctx,url);
}
function sopToken(uid,index){const s=text(uid);return s?sanitizeSegment(s.slice(-24),'uid'):String(index).padStart(5,'0');}

export const VietmyAdapter={
  id:'VIETMY',
  match(summary){return summary?.detector==='VIETMY'||Boolean(bestDetectedRequest(summary?.requests||[],['VIETMY_MANIFEST']));},
  async analyze(ctx){
    const hit=bestDetectedRequest(ctx.summary.requests,['VIETMY_MANIFEST']);if(!hit)throw new Error('Chưa thấy manifest VietMy.');
    // Manifest này CHỈ trả JSON cho POST đúng kiểu; gọi GET là server đưa về
    // trang HTML kèm HTTP 200. Không có gì để phát lại thì nói luôn, đừng thử.
    const meta=requestMetaFor(ctx,hit.url);
    if(!meta)throw new Error('Chưa ghi được request manifest VietMy. Bật "Theo dõi tab" rồi tải lại trang viewer để extension ghi đúng request.');
    const payload=await ctx.fetchJson(hit.url,'application/json, text/json, */*',meta);
    const p=parseVietmyManifest(payload,hit.url);if(!p.groups.length)throw new Error('Manifest VietMy không có filePath DICOM.');
    return ctx.normalizeStudy({adapter:'VIETMY',studyUid:p.studyUid,patient:p.patient,series:p.series,context:{manifestUrl:hit.url,viewerUrl:ctx.summary.bestViewerUrl||ctx.summary.currentUrl||'',completeKnown:true}});
  },
  async enumerate(inv,selected,ctx){
    const req=requestMetaFor(ctx,inv.context.manifestUrl);const payload=await ctx.fetchJson(inv.context.manifestUrl,'application/json, text/json, */*',req);
    const p=parseVietmyManifest(payload,inv.context.manifestUrl);const set=new Set(selected),tasks=[];
    for(let gi=0;gi<p.groups.length;gi++){
      const g=p.groups[gi],choice=g.choice;if(!set.has(choice.id))continue;const folder=seriesFolderName(choice,gi);
      for(let i=0;i<g.images.length;i++){
        const im=g.images[i];let url=im.filePath;
        if(inv.context.viewerUrl){try{url=ctx.inheritQuery(url,inv.context.viewerUrl);}catch{}}
        const n=im.instanceNumber&&/^\d+$/.test(im.instanceNumber)?String(Number(im.instanceNumber)).padStart(5,'0'):String(i+1).padStart(5,'0');
        tasks.push({strategy:'fetch-dicom',url,headers:ctx.headersForUrl(url),method:'GET',studyUid:inv.studyUid||im.studyUid||'',seriesUid:choice.seriesUid||im.seriesUid||'',sopInstanceUid:im.sopInstanceUid||'',relativePath:`${folder}/IM_${n}_${sopToken(im.sopInstanceUid,i+1)}.dcm`});
      }
    }
    return tasks;
  }
};

export { parseVietmyManifest };
