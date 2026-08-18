'use strict';
import { parseVrpacsManifest, bestDetectedRequest, seriesFolderName, sanitizeSegment } from '../pacs.js';

const VRPACS_STANDARD_PORTS = [740, 86, 1325, 997, 82, 8080];

function toUrl(id, host, scuHost){
  let s=String(id||'');
  for(const p of ['wadouri:','wadors:','dicomweb:','dicomfile:']){
    if(s.startsWith(p)){ s=s.slice(p.length); break; }
  }
  if(/^https?:/i.test(s)) return s;
  const targetHost = (s.includes('vrpacs-scu') && scuHost) ? scuHost : (host || '');
  return `${targetHost.replace(/\/+$/, '')}/${s.replace(/^\/+/, '')}`;
}

function extractVrpacsParams(summary){
  const candidates=[summary?.currentUrl,...(summary?.navUrls||[]),...(summary?.frameUrls||[])].filter(Boolean);
  for(const rawUrl of candidates){
    try{
      const u=new URL(rawUrl);
      const params=u.searchParams.get('params');
      if(params&&(u.pathname.includes('viewershare')||u.pathname.includes('vrviewer')||u.pathname.includes('viewer'))){
        let decoded='';
        try{decoded=atob(params);}catch{try{decoded=decodeURIComponent(escape(atob(params)));}catch{}}
        if(decoded.startsWith('{')&&decoded.includes('link')){
          return { url: rawUrl, parsedUrl: u, decodedParams: decoded };
        }
      }
    }catch{}
  }
  return null;
}

function buildSyntheticVrpacsRequest(summary){
  const hit=extractVrpacsParams(summary);
  if(!hit) return null;
  const chunks=[btoa(hit.decodedParams)];
  const manifestUrl=`${hit.parsedUrl.origin}/vrpacs-file/get-share-patient-image`;
  return {
    type:'VRPACS_MANIFEST',
    url:manifestUrl,
    method:'POST',
    requestBody:{kind:'raw',chunks},
    contentType:'application/json',
    score:105,
    sourceUrl:hit.url
  };
}

export const VrpacsAdapter={
  id:'VRPACS',
  match(summary){
    return summary?.detector==='VRPACS'
      || Boolean(bestDetectedRequest(summary?.requests||[],['VRPACS_MANIFEST']))
      || Boolean(extractVrpacsParams(summary));
  },
  async analyze(ctx){
    let hit=bestDetectedRequest(ctx.summary.requests,['VRPACS_MANIFEST']);
    const extracted=extractVrpacsParams(ctx.summary);
    if(!hit?.requestBody && extracted){
      hit=buildSyntheticVrpacsRequest(ctx.summary)||hit;
    }
    if(!hit)throw new Error('VRPACS manifest not detected.');

    // Build probe list: observed URL origin, followed by VRPACS standard ports on same hostname
    const probeUrls=[];
    if(hit.url) probeUrls.push(hit.url);
    if(extracted?.parsedUrl){
      const u=extracted.parsedUrl;
      const hostPorts=[Number(u.port)|| (u.protocol==='https:'?443:80), ...VRPACS_STANDARD_PORTS];
      for(const port of [...new Set(hostPorts)].filter(Boolean)){
        const pUrl=`${u.protocol}//${u.hostname}:${port}/vrpacs-file/get-share-patient-image`;
        if(!probeUrls.includes(pUrl)) probeUrls.push(pUrl);
      }
    }

    let payload=null, winningUrl=hit.url, lastErr=null;
    for(const pUrl of probeUrls){
      try{
        const req={...hit, url: pUrl};
        const res=await ctx.fetchJson(pUrl, 'application/json', req, 4000);
        if(res && typeof res==='object' && (res.data?.studyList || res.data?.pName || res.data?.seriesList || res.status===200 || res.status==='success')){
          payload=res;
          winningUrl=pUrl;
          break;
        }
      }catch(err){
        lastErr=err;
      }
    }

    if(!payload){
      if(lastErr) throw lastErr;
      throw new Error('VRPACS manifest could not be retrieved from any service port.');
    }

    const p=parseVrpacsManifest(payload);
    const st=p.studies?.[0]||{};
    const winningOrigin=new URL(winningUrl).origin;
    const currentOrigin=extracted?.parsedUrl?.origin || winningOrigin;

    return ctx.normalizeStudy({
      adapter:'VRPACS',
      studyUid:String(st.studyUID||st.studyInstanceUID||st.StudyInstanceUID||st.studyUid||st.StudyInsUID||''),
      patient:p.patient,
      series:p.series,
      context:{
        manifestUrl:winningUrl,
        requestMeta:{...hit, url:winningUrl},
        // The file service can answer on a different port than the viewer, which is
        // the whole point of the probe above. Images under /vrpacs-scu/ are still
        // served by the viewer's own origin.
        host:winningOrigin,
        scuHost:currentOrigin,
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
        const url=toUrl(id, inv.context.host, inv.context.scuHost);
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
