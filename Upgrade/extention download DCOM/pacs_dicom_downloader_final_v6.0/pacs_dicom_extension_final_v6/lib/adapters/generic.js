'use strict';
export const GenericAdapter={
  id:'GENERIC',
  match(_summary,state){return Boolean((state?.genericDirectUrls||[]).length);},
  async analyze(ctx){const urls=[...new Set(ctx.state.genericDirectUrls||[])];if(!urls.length)throw new Error('Chưa có endpoint DICOM để tải.');const p=ctx.state.genericProfile||{};return ctx.normalizeStudy({adapter:'GENERIC',studyUid:p.studyUid||'',patient:{name:p.patientName||'',id:p.patientId||'',birthDate:p.patientBirthDate||'',studyDate:p.studyDate||'',description:p.studyDescription||'',accession:p.accessionNumber||''},series:[{id:'generic:0',seriesUid:'',number:'',description:'DICOM',modality:'',imageCount:urls.length,sequenceHint:'',source:'generic'}],context:{directUrls:urls,completeKnown:false}});},
  async enumerate(inv,selected,ctx){if(!selected.includes('generic:0'))return[];let k=0;return(inv.context.directUrls||[]).map(url=>{k++;return{strategy:'fetch-dicom',url,headers:ctx.headersForUrl(url),method:'GET',studyUid:inv.studyUid,seriesUid:'',sopInstanceUid:'',relativePath:`01 - DICOM/IM_${String(k).padStart(5,'0')}.dcm`};});}
};
