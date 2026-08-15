'use strict';

// Generic PACS discovery inspired by datasource/loader abstractions used by OHIF
// and Cornerstone: classify by capabilities and content, not vendor names.

const URL_KEYS = ['url','uri','href','src','file','filepath','fileurl','downloadurl','objecturl','instanceurl','imageurl','wadouri','wadors','bulkdatauri'];
const UID_ALIASES = {
  studyUid:['StudyInstanceUID','studyInstanceUID','studyInstanceUid','StudyUID','studyUID','studyUid','StuInsUID'],
  seriesUid:['SeriesInstanceUID','seriesInstanceUID','seriesInstanceUid','SeriesUID','seriesUID','seriesUid','SeriesInsUID'],
  sopInstanceUid:['SOPInstanceUID','sopInstanceUID','sopInstanceUid','SOPUID','sopUID','sopUid','ObjectUID','objectUID','ImageUID','imageUID'],
  seriesNumber:['SeriesNumber','seriesNumber','SeriesNo','seriesNo','SeriesNum','seriesNum'],
  seriesDescription:['SeriesDescription','seriesDescription','SeriesDesc','seriesDesc','SeriesName','seriesName','ProtocolName','protocolName','SequenceName','sequenceName'],
  modality:['Modality','modality'],
  instanceNumber:['InstanceNumber','instanceNumber','ImageNumber','imageNumber','ImageNo','imageNo','InstanceNo','instanceNo'],
  patientName:['PatientName','patientName','PatName','patName','PatientFullName','patientFullName','FullName','fullName','pName'],
  patientId:['PatientID','PatientId','patientID','patientId','PatID','patID','MRN','mrn','PatientCode','patientCode','pCode','pID'],
  birthDate:['PatientBirthDate','patientBirthDate','BirthDate','birthDate','DOB','dob'],
  studyDate:['StudyDate','studyDate','StudyDatetime','studyDatetime','StudyDateTime','studyDateTime','ExamDate','examDate','PerformedDate','performedDate'],
  studyDescription:['StudyDescription','studyDescription','StudyDesc','studyDesc','StudyName','studyName','ExamName','examName'],
  accession:['AccessionNumber','accessionNumber','AccessionNo','accessionNo','Accession','accession']
};

function normKey(x){return String(x||'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function text(x){return x===undefined||x===null?'':String(x).trim();}
function objectMap(obj){const m=new Map();if(!obj||typeof obj!=='object'||Array.isArray(obj))return m;for(const[k,v]of Object.entries(obj))m.set(normKey(k),v);return m;}
function pick(obj,aliases){const m=objectMap(obj);for(const k of aliases){const v=m.get(normKey(k));if(v!==undefined&&v!==null&&v!=='')return v;}return '';}
function mergeMeta(parent,obj){const out={...(parent||{})};for(const[field,aliases]of Object.entries(UID_ALIASES)){const v=text(pick(obj,aliases));if(v)out[field]=v;}return out;}

function stripLoaderPrefix(raw){let s=text(raw);for(const p of ['wadouri:','wado-uri:','wadors:','wado-rs:','dicomweb:','dicomfile:'])if(s.toLowerCase().startsWith(p)){s=s.slice(p.length).trim();break;}return s;}
export function toHttpUrl(raw,baseUrl=''){
  const s=stripLoaderPrefix(raw);if(!s||s.length>12000)return'';
  if(!(s.startsWith('/')||s.startsWith('?')||/^https?:\/\//i.test(s)))return'';
  try{const u=new URL(s,baseUrl);return ['http:','https:'].includes(u.protocol)?u.href:'';}catch{return'';}
}

export function urlShape(raw){
  try{
    const u=new URL(raw);let path=u.pathname;
    path=path.replace(/\b\d+(?:\.\d+){3,}\b/g,'*UID*');
    path=path.replace(/[0-9a-f]{8}-[0-9a-f-]{20,}/ig,'*UUID*');
    path=path.replace(/(?<=\/)[0-9a-f]{6,}(?=\/|$)/ig,'*HEX*');
    path=path.replace(/[0-9a-f]{20,}/ig,'*HEX*');
    path=path.replace(/\/\d+(?=\/|$)/g,'/*');
    const keys=[...new Set([...u.searchParams.keys()].filter(Boolean).map(normKey))].sort();
    return `${u.protocol}//${u.host}${path}?${keys.join('&')}`;
  }catch{return'';}
}

export function looksLikeDicomJson(value){
  const rows=Array.isArray(value)?value:[value];let checked=0,hits=0;
  for(const row of rows.slice(0,20)){
    if(!row||typeof row!=='object'||Array.isArray(row))continue;
    for(const [k,v] of Object.entries(row).slice(0,80)){
      if(!/^[0-9a-f]{8}$/i.test(k))continue;checked++;
      if(v&&typeof v==='object'&&(typeof v.vr==='string'||Array.isArray(v.Value)||v.BulkDataURI||v.InlineBinary))hits++;
    }
  }
  return checked>=3&&hits/checked>=0.7;
}

function urlishKey(key){const n=normKey(key);return URL_KEYS.some(x=>n===normKey(x))||/(?:url|uri|href|path|file|object|download|instance|image|dicom|wado)$/.test(n);}

/**
 * Find URL-bearing records while retaining ancestry metadata and JSON path.
 * The URL field name is only a weak hint; every string value that resolves to
 * HTTP(S) is allowed, so `/x?a=1` can be discovered even when the key is `v`.
 */
export function extractManifestCandidates(payload,baseUrl,{maxDepth=14,maxCandidates=6000}={}){
  const out=[],seenObj=new Set(),seen=new Set();
  // Patient/study metadata is often a sibling of the series tree. Harvest only
  // study-wide fields globally; never leak Series/SOP fields across branches.
  const globalMeta={};const GLOBAL_FIELDS=new Set(['studyUid','patientName','patientId','birthDate','studyDate','studyDescription','accession']);
  const harvested=new Set();
  function harvest(v,depth=0){if(v==null||depth>6||typeof v!=='object'||harvested.has(v))return;harvested.add(v);if(!Array.isArray(v)){const m=mergeMeta({},v);for(const[k,x]of Object.entries(m))if(GLOBAL_FIELDS.has(k)&&x&&!globalMeta[k])globalMeta[k]=x;}if(Array.isArray(v)){for(const x of v.slice(0,2000))harvest(x,depth+1);}else for(const x of Object.values(v))if(x&&typeof x==='object')harvest(x,depth+1);}
  harvest(payload);
  function walk(v,meta=globalMeta,path='$',depth=0){
    if(v==null||depth>maxDepth||out.length>=maxCandidates)return;
    if(Array.isArray(v)){for(let i=0;i<Math.min(v.length,25000);i++)walk(v[i],meta,`${path}[${i}]`,depth+1);return;}
    if(typeof v!=='object')return;if(seenObj.has(v))return;seenObj.add(v);
    const nextMeta=mergeMeta(meta,v);
    for(const[k,x]of Object.entries(v)){
      if(typeof x!=='string')continue;const url=toHttpUrl(x,baseUrl);if(!url)continue;
      const id=`${url}|${path}.${k}`;if(seen.has(id))continue;seen.add(id);
      out.push({url,key:k,path:`${path}.${k}`,shape:urlShape(url),meta:{...nextMeta},keyHint:urlishKey(k)?1:0});
      if(out.length>=maxCandidates)return;
    }
    for(const[k,x]of Object.entries(v))if(x&&typeof x==='object')walk(x,nextMeta,`${path}.${k}`,depth+1);
  }
  walk(payload,globalMeta,'$',0);return out;
}

export function clusterCandidates(candidates){
  const map=new Map();
  for(const c of candidates||[]){const key=c.shape||urlShape(c.url)||c.url;if(!map.has(key))map.set(key,{shape:key,rows:[],keyHints:0});const g=map.get(key);g.rows.push(c);g.keyHints+=c.keyHint||0;}
  return [...map.values()].sort((a,b)=>{
    const as=Math.min(a.rows.length,1000)+(a.keyHints?5:0),bs=Math.min(b.rows.length,1000)+(b.keyHints?5:0);return bs-as;
  });
}

export function candidateProbePlan(candidates,recipe=null,{maxGroups=24,samplesPerGroup=2}={}){
  let groups=clusterCandidates(candidates);
  if(recipe?.dicomShape){groups=[...groups].sort((a,b)=>(b.shape===recipe.dicomShape?1:0)-(a.shape===recipe.dicomShape?1:0));}
  const out=[];
  for(const g of groups.slice(0,maxGroups))for(const row of g.rows.slice(0,samplesPerGroup))out.push({...row,clusterShape:g.shape});
  return out;
}

export function recordsForSuccessfulShapes(candidates,successShapes){
  const ok=new Set(successShapes||[]);return (candidates||[]).filter(c=>ok.has(c.shape));
}

export function manifestRecipeFromDiscovery(manifestUrl,requestMeta,winningRows){
  const rows=winningRows||[];if(!rows.length)return null;
  const counts=new Map();for(const r of rows)counts.set(r.shape,(counts.get(r.shape)||0)+1);
  const dicomShape=[...counts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||'';
  const sample=rows.find(r=>r.shape===dicomShape)||rows[0];
  return{
    manifestShape:urlShape(manifestUrl),
    method:String(requestMeta?.method||'GET').toUpperCase(),
    dicomShape,
    urlKey:String(sample?.key||''),
    urlPath:String(sample?.path||'').replace(/\[\d+\]/g,'[*]'),
    updatedAt:Date.now()
  };
}

export function studyProfileFromProbeDetails(details){
  const metas=(details||[]).map(x=>x?.meta).filter(Boolean);if(!metas.length)return{};
  // Nhận cả tên của header DICOM (`patientBirthDate`) lẫn tên của manifest
  // (`birthDate`) — cùng một trường, hai nguồn đặt tên khác nhau.
  const first=(...fields)=>{for(const f of fields){const hit=metas.find(m=>text(m?.[f]));if(hit)return text(hit[f]);}return '';};
  return{
    studyUid:first('studyUid'),patientName:first('patientName'),patientId:first('patientId'),patientBirthDate:first('patientBirthDate','birthDate'),studyDate:first('studyDate'),studyDescription:first('studyDescription'),accessionNumber:first('accessionNumber','accession')
  };
}

export function groupGenericEntries(entries){
  const groups=new Map();
  for(const entry of entries||[]){
    const m=entry.meta||{},seriesUid=text(m.seriesUid)||text(entry.declared?.seriesUid),number=text(m.seriesNumber)||text(entry.declared?.seriesNumber),description=text(m.seriesDescription)||text(entry.declared?.seriesDescription)||'DICOM',modality=text(m.modality)||text(entry.declared?.modality);
    const key=seriesUid||`${number}|${description}|${modality}`||'unknown';
    if(!groups.has(key))groups.set(key,{seriesUid,number,description,modality,entries:[]});groups.get(key).entries.push(entry);
  }
  return [...groups.values()];
}
