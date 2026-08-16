'use strict';
import { parseVradManifest, bestDetectedRequest, seriesFolderName, sanitizeSegment } from '../pacs.js';

function objectKey(web){if(!web)return'';try{return new URLSearchParams(String(web).replace(/^\?/, '')).get('imageObjKey')||'';}catch{return'';}}
function sopToken(uid,index){const s=String(uid||'').trim();return s?sanitizeSegment(s.slice(-24),'uid'):String(index).padStart(5,'0');}

export const VradAdapter={
  id:'VRAD',
  match(summary){return summary?.detector==='VRAD'||Boolean(bestDetectedRequest(summary?.requests||[],['VRAD_MANIFEST']));},
  async analyze(ctx){
    const man=bestDetectedRequest(ctx.summary.requests,['VRAD_MANIFEST']);if(!man)throw new Error('VRAD manifest not detected.');
    const payload=await ctx.fetchJson(man.url,'application/json',man);const p=parseVradManifest(payload);const template=bestDetectedRequest(ctx.summary.requests,['DICOM_IMAGE_API']);
    return ctx.normalizeStudy({adapter:'VRAD',studyUid:String(p.study?.StuInsUID||p.study?.StudyInstanceUID||''),patient:p.patient,series:p.series,context:{manifestUrl:man.url,templateUrl:template?.url||'',completeKnown:true}});
  },
  async enumerate(inv,selected,ctx){
    const state=ctx.state,req=(state.pacsRequests||[]).find(x=>x.type==='VRAD_MANIFEST'&&x.url===inv.context.manifestUrl);const payload=await ctx.fetchJson(inv.context.manifestUrl,'application/json',req);const p=parseVradManifest(payload);const selectedSet=new Set(selected);let template=null;
    try{template=inv.context.templateUrl?new URL(inv.context.templateUrl):null;}catch{}
    const tasks=[];let expected=0;
    for(let si=0;si<p.rawSeries.length;si++){
      const raw=p.rawSeries[si],choice=p.series[si];if(!selectedSet.has(choice.id))continue;expected+=Number(raw.ImageCount||0)||0;
      const base=(template?`${template.protocol}//${template.host}${template.pathname}`:raw.ImageBaseUrl||'');if(!base)continue;const baseParams=template?new URLSearchParams(template.search):new URLSearchParams();const folder=seriesFolderName(choice,si);let k=0;
      for(const im of (raw.ImageList||[])){
        const key=objectKey(im.WebUrl||'');if(!key)continue;k++;const qs=new URLSearchParams(baseParams);qs.set('imageObjKey',key);qs.set('signature',im.Signature||'');qs.set('seriesuid',raw.SeriesInsUID||qs.get('seriesuid')||'');qs.set('studyuid',raw.StuInsUID||qs.get('studyuid')||'');qs.set('imageUid',im.SOPInstanceUID||'');qs.set('imageid',String(im.ImageID||0));if(raw.Expires||im.Expires)qs.set('expires',String(raw.Expires||im.Expires));
        const sop=String(im.SOPInstanceUID||'').trim();tasks.push({strategy:'fetch-dicom',url:`${base}?${qs}`,headers:ctx.headersForUrl(base),method:'GET',studyUid:inv.studyUid,seriesUid:choice.seriesUid||'',sopInstanceUid:sop,relativePath:`${folder}/IM_${String(k).padStart(5,'0')}_${sopToken(sop,k)}.dcm`});
      }
    }
    if(expected&&tasks.length<expected)throw new Error(`Manifest lists ${expected} images but only generated ${tasks.length} DICOM URLs.`);return tasks;
  }
};

