import {VradAdapter} from '../lib/adapters/vrad.js';
import {VrpacsAdapter} from '../lib/adapters/vrpacs.js';
import {DicomwebAdapter} from '../lib/adapters/dicomweb.js';
import {VietmyAdapter, parseVietmyManifest} from '../lib/adapters/vietmy.js';
import {Mach7Adapter} from '../lib/adapters/mach7.js';
const normalizeStudy=x=>x;
const inheritQuery=(target,source)=>{const t=new URL(target),s=new URL(source);for(const[k,v]of s.searchParams)if(!t.searchParams.has(k))t.searchParams.append(k,v);return t.href};
const headersForUrl=()=>({});
const vradPayload={data:[{PatientName:'TEST^PATIENT',PatientID:'P1',StudyDate:'20260813',StuInsUID:'1.2.3',SeriesList:[{SeriesInsUID:'1.2.3.1',SeriesNumber:'1',SeriesDescription:'AX T2',Modality:'MR',ImageCount:1,StuInsUID:'1.2.3',ImageList:[{WebUrl:'?imageObjKey=abc',Signature:'sig',SOPInstanceUID:'1.2.3.1.1',ImageID:9}]}]}]};
let summary={detector:'VRAD',requests:[{type:'VRAD_MANIFEST',url:'https://x.test/StudyData/GetStudies',score:100,method:'GET'},{type:'DICOM_IMAGE_API',url:'https://x.test/GetImage?vendor=1',score:88}]};
let state={pacsRequests:summary.requests};let ctx={summary,state,normalizeStudy,headersForUrl,inheritQuery,fetchJson:async()=>vradPayload};
let inv=await VradAdapter.analyze(ctx);let tasks=await VradAdapter.enumerate(inv,[inv.series[0].id],ctx);if(tasks.length!==1||tasks[0].strategy!=='fetch-dicom'||!tasks[0].url.includes('imageObjKey=abc'))throw new Error('VRAD adapter');
const vrp={data:{studyList:[{studyInstanceUID:'2.3.4',patientName:'TEST',patientId:'P2',studyDate:'20260813',seriesList:[{SeriesInstanceUID:'2.3.4.1',SeriesNumber:'2',SeriesDescription:'CT',Modality:'CT',imageIds:['wadouri:/study-get-public?file=a.dcm']}]}]}};
summary={detector:'VRPACS',requests:[{type:'VRPACS_MANIFEST',url:'https://y.test/get-share-patient-image',score:100,method:'GET'}]};state={pacsRequests:summary.requests};ctx={summary,state,normalizeStudy,headersForUrl,inheritQuery,fetchJson:async()=>vrp};inv=await VrpacsAdapter.analyze(ctx);tasks=await VrpacsAdapter.enumerate(inv,[inv.series[0].id],ctx);if(tasks.length!==1||!tasks[0].url.includes('study-get-public'))throw new Error('VRPACS adapter');
const qido='https://z.test/dicomweb/studies/3.4.5/series';const series=[{'0020000E':{vr:'UI',Value:['3.4.5.1']},'00200011':{vr:'IS',Value:['3']},'0008103E':{vr:'LO',Value:['T1']},'00080060':{vr:'CS',Value:['MR']},'00201209':{vr:'IS',Value:[1]}}];
const inst=[{'00080018':{vr:'UI',Value:['3.4.5.1.1']},'0020000E':{vr:'UI',Value:['3.4.5.1']},'00280008':{vr:'IS',Value:[1]}}];
summary={detector:'DICOMWEB',requests:[{type:'QIDO_SERIES',url:qido,score:110}]};state={pacsRequests:summary.requests};ctx={summary,state,normalizeStudy,headersForUrl,inheritQuery,fetchJson:async url=>url.endsWith('/series')?series:url.includes('/instances')?inst:[]};inv=await DicomwebAdapter.analyze(ctx);tasks=await DicomwebAdapter.enumerate(inv,[inv.series[0].id],ctx);if(tasks.length!==1||tasks[0].strategy!=='dicomweb-instance'||tasks[0].sopInstanceUid!=='3.4.5.1.1')throw new Error('DICOMweb adapter');
console.log('Adapter registry tests OK');

const vietPayload={d:JSON.stringify({PatientName:'NGUYEN THI VAN',PatientID:'81T',StudyDate:'20260730',StudyInstanceUID:'1.2.840.100',Series:[{SeriesInstanceUID:'1.2.840.100.7',SeriesNumber:'7',SeriesDescription:'T2 SAG',Modality:'MR',Images:[{SOPInstanceUID:'1.2.840.100.7.1',InstanceNumber:'1',filePath:'/ws/getfile.ashx?file=a&stoken=abc',imagePath:'/ws/getimagefile.ashx?file=a&stoken=abc'},{SOPInstanceUID:'1.2.840.100.7.2',InstanceNumber:'2',filePath:'/ws/getfile.ashx?file=b&stoken=abc',imagePath:'/ws/getimagefile.ashx?file=b&stoken=abc'}]},{SeriesInstanceUID:'1.2.840.100.8',SeriesNumber:'8',SeriesDescription:'T1 SAG',Modality:'MR',Images:[{SOPInstanceUID:'1.2.840.100.8.1',InstanceNumber:'1',filePath:'/ws/getfile.ashx?file=c&stoken=abc'}]}]})};
const parsedViet=parseVietmyManifest(vietPayload,'https://vietmy.pmr.vn/WS/ws.asmx/GetListImageFileInfo');
if(parsedViet.series.length!==2||parsedViet.groups.reduce((n,g)=>n+g.images.length,0)!==3)throw new Error('VietMy manifest parser');
summary={detector:'VIETMY',bestViewerUrl:'https://vietmy.pmr.vn/Pages/ShareStudy.aspx?stoken=abc',requests:[{type:'VIETMY_MANIFEST',url:'https://vietmy.pmr.vn/WS/ws.asmx/GetListImageFileInfo',score:120,method:'POST',requestBody:{kind:'raw',chunks:[]}}]};
state={pacsRequests:summary.requests};ctx={summary,state,normalizeStudy,headersForUrl,inheritQuery,fetchJson:async()=>vietPayload};
inv=await VietmyAdapter.analyze(ctx);tasks=await VietmyAdapter.enumerate(inv,[inv.series[0].id],ctx);
if(inv.patient.id!=='81T'||inv.series.length!==2||tasks.length!==2)throw new Error('VietMy adapter inventory');
if(tasks.some(t=>!t.url.includes('/ws/getfile.ashx')||t.url.includes('getimagefile')))throw new Error('VietMy must use filePath/getfile only');
if(tasks.some(t=>t.strategy!=='fetch-dicom'))throw new Error('VietMy task strategy');
console.log('VietMy adapter tests OK');

// Test Mach7 Adapter
summary={detector:'MACH7',currentUrl:'http://cdha.benhviencuadong.vn/ClinicalStudio/Procedures/ProcedureComposite?ID=csyKbu5XEZv7awWCYleVbA%3d%3d',requests:[{type:'MACH7_MANIFEST',url:'http://cdha.benhviencuadong.vn/ClinicalStudio/Procedures/ProcedureComposite?ID=csyKbu5XEZv7awWCYleVbA%3d%3d',score:115}]};
state={
  domPatient:{
    patientName:'HOANG THI HOAI THUONG TAM DAN 2011',
    patientId:'26100659',
    patientAge:'014Y',
    studyDate:'7/2/2026 2:34 PM',
    accessionNumber:'10742287',
    studyDescription:'Chup cong huong tu cot song that lung',
    modality:'MR',
    isMach7:true
  },
  domSeries:[
    {number:'1',description:'Series 1',imageCount:27},
    {number:'2',description:'Series 2',imageCount:12},
    {number:'3',description:'Series 3',imageCount:15},
    {number:'4',description:'Series 4',imageCount:20},
    {number:'5',description:'Series 5',imageCount:18}
  ],
  genericEntries:[
    {url:'http://cdha.benhviencuadong.vn/ClinicalStudio/wado?study=1.2.3&series=1.2.3.1&object=1.2.3.1.1',method:'GET',meta:{studyUid:'1.2.3',seriesUid:'1.2.3.1',sopInstanceUid:'1.2.3.1.1',instanceNumber:'1',seriesDescription:'AX T2',modality:'MR'}}
  ]
};
ctx={summary,state,normalizeStudy,headersForUrl,inheritQuery};
if(!Mach7Adapter.match(summary,state))throw new Error('Mach7 match failed');
inv=await Mach7Adapter.analyze(ctx);
if(inv.adapter!=='MACH7')throw new Error('Mach7 adapter id');
if(inv.patient.name!=='HOANG THI HOAI THUONG TAM DAN 2011'||inv.patient.id!=='26100659'||inv.patient.accession!=='10742287')throw new Error('Mach7 patient parse failed');
if(inv.series.length!==5)throw new Error(`Expected 5 series from Mach7 DOM merging, got ${inv.series.length}`);
tasks=await Mach7Adapter.enumerate(inv,[inv.series[0].id],ctx);
if(tasks.length!==1||!tasks[0].url.includes('ClinicalStudio/wado')||tasks[0].strategy!=='fetch-dicom')throw new Error('Mach7 enumerate failed');
console.log('Mach7 adapter tests OK');
