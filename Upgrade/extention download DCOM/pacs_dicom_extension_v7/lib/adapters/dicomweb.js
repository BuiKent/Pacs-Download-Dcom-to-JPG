'use strict';
import { bestDetectedRequest, deriveDicomweb, parseDicomwebSeries, dicomJsonValue, seriesFolderName, sanitizeSegment, fetchQidoPaged } from '../pacs.js';
const JSON_ACCEPT='application/dicom+json, application/json';
const sopKey=x=>String(dicomJsonValue(x,'00080018')||'').trim();
/** Read all QIDO instances endpoint with automatic pagination. */
const allInstances=(ctx,url)=>fetchQidoPaged((u,a)=>ctx.fetchJson(u,a),url,{accept:JSON_ACCEPT,keyOf:sopKey});
function uid(inst,tag){return String(dicomJsonValue(inst,tag)||'').trim();}
function frames(inst){return Math.max(1,Number(dicomJsonValue(inst,'00280008')||1)||1);}
function patient(meta){const pn=dicomJsonValue(meta,'00100010');return{name:pn&&typeof pn==='object'?(pn.Alphabetic||''):String(pn||''),id:String(dicomJsonValue(meta,'00100020')||''),birthDate:String(dicomJsonValue(meta,'00100030')||''),studyDate:String(dicomJsonValue(meta,'00080020')||''),description:String(dicomJsonValue(meta,'00081030')||''),accession:String(dicomJsonValue(meta,'00080050')||'')};}
export const DicomwebAdapter={
  id:'DICOMWEB',
  match(summary, state){
    if(summary?.detector==='DICOMWEB')return true;
    if(Boolean(bestDetectedRequest(summary?.requests||[],['QIDO_SERIES','QIDO_INSTANCES','DICOM_METADATA','DICOM_INSTANCE','DICOM_FRAME','WADO'])))return true;
    const cur=summary?.bestViewerUrl||summary?.currentUrl||'';
    if(Boolean(cur.includes('/viewer')&&/[?&]studies=/.test(cur)&&/[?&]session=/.test(cur)))return true;
    if(Boolean(deriveDicomweb(cur)))return true;
    if(state?.dicomwebPayloads&&Object.keys(state.dicomwebPayloads).length>0)return true;
    return false;
  },
  async analyze(ctx){
    const qido=bestDetectedRequest(ctx.summary.requests,['QIDO_SERIES']);
    let seed=qido?.url||bestDetectedRequest(ctx.summary.requests,['QIDO_INSTANCES','DICOM_METADATA','DICOM_INSTANCE','DICOM_FRAME','WADO'])?.url;
    if(!seed){
      const cur=ctx.summary?.bestViewerUrl||ctx.summary?.currentUrl||'';
      try{
        const u=new URL(cur),session=u.searchParams.get('session'),studies=u.searchParams.get('studies');
        if(session&&studies)seed=`${u.origin}/ws/rest/wado-rs/${encodeURIComponent(session)}/studies/${encodeURIComponent(studies)}/series`;
        else seed=cur;
      }catch{
        seed=cur;
      }
    }
    const d=deriveDicomweb(seed);
    if(!d)throw new Error('Unable to extract StudyInstanceUID from DICOMweb.');
    const seriesUrl=qido?.url||ctx.inheritQuery(`${d.rsBase}/studies/${encodeURIComponent(d.studyUid)}/series`,seed);
    let raw=ctx.state?.dicomwebPayloads?.[seriesUrl]||ctx.state?.dicomwebPayloads?.[new URL(seriesUrl).pathname]||null;
    if(!raw){
      try{
        raw=await ctx.fetchJson(seriesUrl,'application/dicom+json, application/json');
      }catch(err){
        for(const [k,v] of Object.entries(ctx.state?.dicomwebPayloads||{})){
          if(k.includes(d.studyUid)&&Array.isArray(v)){raw=v;break;}
        }
        if(!raw)throw err;
      }
    }
    let series=parseDicomwebSeries(raw);
    if(!series.length){
      const list=Array.isArray(raw)?raw:(Array.isArray(raw?.data)?raw.data:[]);
      if(list.length&&dicomJsonValue(list[0],'00080018')){
        const groups=new Map();
        for(const inst of list){
          const su=String(dicomJsonValue(inst,'0020000E')||inst?.SeriesInstanceUID||'').trim();
          if(!su)continue;
          if(!groups.has(su)){
            const sn=String(dicomJsonValue(inst,'00200011')||inst?.SeriesNumber||'');
            const sd=String(dicomJsonValue(inst,'0008103E')||inst?.SeriesDescription||`Series ${sn||groups.size+1}`);
            const mod=String(dicomJsonValue(inst,'00080060')||inst?.Modality||'CT');
            groups.set(su,{SeriesInstanceUID:su,SeriesNumber:sn,SeriesDescription:sd,Modality:mod,ImageCount:0});
          }
          groups.get(su).ImageCount++;
        }
        for(const [idx,g] of [...groups.values()].entries()){
          series.push(normalizeSeries(g,'dicomweb',idx));
        }
      }
    }
    if(!series.length)throw new Error('No series found in DICOMweb study.');
    const enriched=[];
    for(const s of series){
      let count=s.imageCount;
      if(!count){
        try{
          const arr=await allInstances(ctx,ctx.inheritQuery(`${d.rsBase}/studies/${encodeURIComponent(d.studyUid)}/series/${encodeURIComponent(s.seriesUid)}/instances`,seriesUrl));
          count=arr.length;
        }catch{}
      }
      enriched.push({...s,imageCount:count});
    }
    let p=patient(Array.isArray(raw)?(raw[0]||{}):raw);
    if(!p.name&&!p.id){
      try{
        const st=await ctx.fetchJson(ctx.inheritQuery(`${d.rsBase}/studies/${encodeURIComponent(d.studyUid)}`,seriesUrl),'application/dicom+json, application/json',null,2500);
        const sp=patient(Array.isArray(st)?(st[0]||{}):st);
        if(sp.name||sp.id)p=sp;
      }catch{}
    }
    const wado=bestDetectedRequest(ctx.summary.requests,['WADO']);
    return ctx.normalizeStudy({adapter:'DICOMWEB',studyUid:d.studyUid,patient:p,series:enriched,context:{rsBase:d.rsBase,seriesUrl,studyUid:d.studyUid,wadoTemplate:wado?.url||'',completeKnown:true}});
  },
  async enumerate(inv,selected,ctx){const set=new Set(selected),tasks=[];const rs=inv.context.rsBase,study=inv.context.studyUid,q=inv.context.seriesUrl;let wado=null;try{wado=inv.context.wadoTemplate?new URL(inv.context.wadoTemplate):null;}catch{}let studyWide=null;async function getWide(){if(studyWide)return studyWide;studyWide={};for(const ep of [`${rs}/studies/${encodeURIComponent(study)}/instances`,`${rs}/studies/${encodeURIComponent(study)}/metadata`]){try{const a=ep.endsWith('/metadata')?await ctx.fetchJson(ctx.inheritQuery(ep,q),JSON_ACCEPT):await allInstances(ctx,ctx.inheritQuery(ep,q));if(!Array.isArray(a)||!a.length)continue;for(const x of a){const su=uid(x,'0020000E');if(su)(studyWide[su] ||= []).push(x);}if(Object.keys(studyWide).length)break;}catch{}}return studyWide;}
    for(let si=0;si<inv.series.length;si++){const s=inv.series[si];if(!set.has(s.id))continue;const folder=seriesFolderName(s,si),instancesUrl=ctx.inheritQuery(`${rs}/studies/${encodeURIComponent(study)}/series/${encodeURIComponent(s.seriesUid)}/instances`,q);let inst=[];try{inst=await allInstances(ctx,instancesUrl);}catch{}if(!Array.isArray(inst))inst=[];if(!inst.length||(s.imageCount&&inst.length<s.imageCount)){try{const m=await ctx.fetchJson(ctx.inheritQuery(`${rs}/studies/${encodeURIComponent(study)}/series/${encodeURIComponent(s.seriesUid)}/metadata`,q),'application/dicom+json, application/json');if(Array.isArray(m)&&m.length>inst.length)inst=m;}catch{}}if(!inst.length||(s.imageCount&&inst.length<s.imageCount)){const g=await getWide();if((g[s.seriesUid]||[]).length>inst.length)inst=g[s.seriesUid];}if(!inst.length){for(const [k,v] of Object.entries(ctx.state?.dicomwebPayloads||{})){if(k.includes(s.seriesUid)&&Array.isArray(v)&&v.length){inst=v;break;}}}const unique=new Map();for(const x of inst){const i=uid(x,'00080018');if(i)unique.set(i,x);}inst=[...unique.values()];if(s.imageCount&&inst.length<s.imageCount)throw new Error(`Series ${s.number||si+1}: ${inst.length}/${s.imageCount} instances.`);let k=0;for(const x of inst){const iuid=uid(x,'00080018');if(!iuid)continue;k++;const base=ctx.inheritQuery(`${rs}/studies/${encodeURIComponent(study)}/series/${encodeURIComponent(s.seriesUid)}/instances/${encodeURIComponent(iuid)}`,q);let primaryUrl='';if(wado){const u=new URL(wado.href);u.searchParams.set('requestType','WADO');u.searchParams.set('studyUID',study);u.searchParams.set('seriesUID',s.seriesUid);u.searchParams.set('objectUID',iuid);u.searchParams.set('contentType','application/dicom');u.searchParams.set('transferSyntax','*');primaryUrl=u.href;}tasks.push({strategy:'dicomweb-instance',url:primaryUrl,instanceBase:base,meta:x,numberOfFrames:frames(x),headers:ctx.headersForUrl(primaryUrl||base),studyUid:study,seriesUid:s.seriesUid,sopInstanceUid:iuid,relativePath:`${folder}/IM_${String(k).padStart(5,'0')}_${sanitizeSegment(iuid.slice(-24),'uid')}.dcm`});}}
    return tasks;
  }
};

