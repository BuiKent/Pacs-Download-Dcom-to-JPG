'use strict';
import { parseVrpacsManifest, bestDetectedRequest, seriesFolderName, sanitizeSegment } from '../pacs.js';

function toUrl(id,host){let s=String(id||'');for(const p of ['wadouri:','wadors:','dicomweb:','dicomfile:'])if(s.startsWith(p)){s=s.slice(p.length);break;}return /^https?:/i.test(s)?s:`${host}/${s.replace(/^\//,'')}`;}

function buildSyntheticVrpacsRequest(summary){
  const candidates=[summary?.currentUrl,...(summary?.navUrls||[]),...(summary?.frameUrls||[])].filter(Boolean);
  for(const rawUrl of candidates){
    try{
      const u=new URL(rawUrl);
      const params=u.searchParams.get('params');
      if(params&&(u.pathname.includes('viewershare')||u.pathname.includes('vrviewer')||u.pathname.includes('viewer'))){
        let decoded='';
        try{decoded=atob(params);}catch{try{decoded=decodeURIComponent(escape(atob(params)));}catch{}}
        if(decoded.startsWith('{')&&decoded.includes('link')){
          const manifestUrl=`${u.origin}/vrpacs-file/get-share-patient-image`;
          const chunks=[btoa(decoded)];
          return {
            type:'VRPACS_MANIFEST',
            url:manifestUrl,
            method:'POST',
            requestBody:{kind:'raw',chunks},
            contentType:'application/json',
            score:105
          };
        }
      }
    }catch{}
  }
  return null;
}

export const VrpacsAdapter={
  id:'VRPACS',
  match(summary){
    return summary?.detector==='VRPACS'
      || Boolean(bestDetectedRequest(summary?.requests||[],['VRPACS_MANIFEST']))
      || Boolean(buildSyntheticVrpacsRequest(summary));
  },
  async analyze(ctx){
    let hit=bestDetectedRequest(ctx.summary.requests,['VRPACS_MANIFEST']);
    if(!hit?.requestBody){
      hit=buildSyntheticVrpacsRequest(ctx.summary)||hit;
    }
    if(!hit)throw new Error('VRPACS manifest not detected.');
    const payload=await ctx.fetchJson(hit.url,'application/json',hit);
    const p=parseVrpacsManifest(payload);
    const st=p.studies?.[0]||{};
    return ctx.normalizeStudy({
      adapter:'VRPACS',
      studyUid:String(st.studyUID||st.studyInstanceUID||st.StudyInstanceUID||st.studyUid||st.StudyInsUID||''),
      patient:p.patient,
      series:p.series,
      context:{
        manifestUrl:hit.url,
        requestMeta:hit,
        host:new URL(hit.url).origin,
        completeKnown:true
      }
    });
  },
  async enumerate(inv,selected,ctx){
    const state=ctx.state;
    const req=(state.pacsRequests||[]).find(x=>x.type==='VRPACS_MANIFEST'&&x.url===inv.context.manifestUrl)||inv.context?.requestMeta;
    const p=parseVrpacsManifest(await ctx.fetchJson(inv.context.manifestUrl,'application/json',req));
    const set=new Set(selected),tasks=[];
    for(let i=0;i<p.rawSeries.length;i++){
      const raw=p.rawSeries[i],choice=p.series[i];
      if(!set.has(choice.id))continue;
      const folder=seriesFolderName(choice,i);
      let k=0;
      for(const id of (raw.imageIds||[])){
        if(!id)continue;
        k++;
        const url=toUrl(id,inv.context.host);
        tasks.push({
          strategy:'fetch-dicom',
          url,
          headers:ctx.headersForUrl(url),
          method:'GET',
          studyUid:inv.studyUid,
          seriesUid:choice.seriesUid||'',
          sopInstanceUid:'',
          relativePath:`${folder}/IM_${String(k).padStart(5,'0')}_${sanitizeSegment(String(id).split('/').pop()?.slice(-28)||String(k),'image')}.dcm`
        });
      }
    }
    return tasks;
  }
};

