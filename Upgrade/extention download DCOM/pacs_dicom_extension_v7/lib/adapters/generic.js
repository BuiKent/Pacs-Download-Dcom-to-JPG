'use strict';
import { normalizeSeries, seriesFolderName, sanitizeSegment } from '../pacs.js';
import { groupGenericEntries } from '../generic_discovery.js';

const uid=v=>{const s=String(v||'').trim();return /^\d+(?:\.\d+)+$/.test(s)?s:'';};
// `meta` là header DICOM thật đã dò (lib/dicom.js), `declared` là thứ manifest tự
// khai (lib/generic_discovery.js). Hai bên đặt tên khác nhau cho cùng một trường,
// nên phải tra bằng cả hai tên — nếu không, ngày sinh và số accession mà manifest
// có sẵn sẽ rơi im lặng.
const DECLARED_ALIAS={patientBirthDate:'birthDate',accessionNumber:'accession'};
const metaField=(entry,name)=>String(
  entry?.meta?.[name]||entry?.declared?.[name]||entry?.declared?.[DECLARED_ALIAS[name]||name]||''
).trim();
function entriesFromState(state){
  const entries=Array.isArray(state?.genericEntries)?state.genericEntries.filter(x=>x?.url):[];
  if(entries.length)return entries;
  return [...new Set(state?.genericDirectUrls||[])].map(url=>({url,method:'GET',requestBody:null,contentType:'',declared:{},meta:null,source:'legacy-generic'}));
}

export const GenericAdapter={
  id:'GENERIC',
  match(_summary,state){return entriesFromState(state).length>0;},
  async analyze(ctx){
    const entries=entriesFromState(ctx.state);if(!entries.length)throw new Error('Chưa có endpoint DICOM đã được xác nhận.');
    const p=ctx.state.genericProfile||{},groups=groupGenericEntries(entries);
    const series=groups.map((g,i)=>normalizeSeries({SeriesInstanceUID:g.seriesUid,SeriesNumber:g.number,SeriesDescription:g.description,Modality:g.modality,ImageCount:g.entries.length},'generic',i));
    groups.forEach((g,i)=>g.choice=series[i]);
    const first=entries.find(x=>x.meta)||{},study=uid(p.studyUid)||uid(metaField(first,'studyUid'));
    return ctx.normalizeStudy({
      adapter:'GENERIC',studyUid:study,
      patient:{name:p.patientName||metaField(first,'patientName'),id:p.patientId||metaField(first,'patientId'),birthDate:p.patientBirthDate||metaField(first,'patientBirthDate'),studyDate:p.studyDate||metaField(first,'studyDate'),description:p.studyDescription||metaField(first,'studyDescription'),accession:p.accessionNumber||metaField(first,'accessionNumber')},
      series,context:{groups,completeKnown:false,generic:true}
    });
  },
  async enumerate(inv,selected,ctx){
    const set=new Set(selected),tasks=[];const groups=inv.context?.groups||[];
    for(let gi=0;gi<groups.length;gi++){
      const g=groups[gi],choice=g.choice||inv.series[gi];if(!choice||!set.has(choice.id))continue;const folder=seriesFolderName(choice,gi);
      for(let i=0;i<g.entries.length;i++){
        const e=g.entries[i],actualSop=uid(metaField(e,'sopInstanceUid')),actualStudy=uid(metaField(e,'studyUid'))||uid(inv.studyUid),actualSeries=uid(metaField(e,'seriesUid'))||uid(choice.seriesUid);
        const nRaw=metaField(e,'instanceNumber'),n=/^\d+$/.test(nRaw)?String(Number(nRaw)).padStart(5,'0'):String(i+1).padStart(5,'0');
        const token=actualSop?sanitizeSegment(actualSop.slice(-24),'uid'):String(i+1).padStart(5,'0');
        tasks.push({strategy:'fetch-dicom',url:e.url,method:String(e.method||'GET').toUpperCase(),requestBody:e.requestBody||null,contentType:e.contentType||'',headers:ctx.headersForUrl(e.url),studyUid:actualStudy,seriesUid:actualSeries,sopInstanceUid:actualSop,relativePath:`${folder}/IM_${n}_${token}.dcm`});
      }
    }
    return tasks;
  }
};
