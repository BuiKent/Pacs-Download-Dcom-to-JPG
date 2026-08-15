import {extractManifestCandidates,clusterCandidates,candidateProbePlan,recordsForSuccessfulShapes,manifestRecipeFromDiscovery,looksLikeDicomJson,urlShape} from '../lib/generic_discovery.js';

const payload={patient:{PatientName:'TEST^GENERIC',PatientID:'P7'},study:{StudyInstanceUID:'1.2.840.7',series:[{SeriesInstanceUID:'1.2.840.7.1',SeriesNumber:1,SeriesDescription:'T2 AX',objects:[{SOPInstanceUID:'1.2.840.7.1.1',v:'/blob/93f1a2?id=aa'},{SOPInstanceUID:'1.2.840.7.1.2',v:'/blob/a19c22?id=bb'}]},{SeriesInstanceUID:'1.2.840.7.2',SeriesNumber:2,SeriesDescription:'T1 SAG',objects:[{SOPInstanceUID:'1.2.840.7.2.1',v:'/blob/88af77?id=cc'}]}]}};
const rows=extractManifestCandidates(payload,'https://pacs.example/api/manifest');
if(rows.length!==3)throw new Error(`expected 3 URL candidates, got ${rows.length}`);
if(!rows.every(x=>x.meta.studyUid==='1.2.840.7'&&x.meta.patientId==='P7'))throw new Error('ancestry metadata not propagated');
if(!rows.some(x=>x.meta.seriesUid==='1.2.840.7.2'))throw new Error('series metadata missing');
const groups=clusterCandidates(rows);if(groups.length!==1)throw new Error(`URL shape clustering failed: ${groups.length}`);
const plan=candidateProbePlan(rows,null,{maxGroups:8,samplesPerGroup:1});if(plan.length!==1)throw new Error('probe plan should sample one per shape');
const winning=recordsForSuccessfulShapes(rows,[plan[0].shape]);if(winning.length!==3)throw new Error('winning shape should materialize full collection');
const recipe=manifestRecipeFromDiscovery('https://pacs.example/api/manifest',{method:'POST'},winning);if(recipe.method!=='POST'||!recipe.dicomShape)throw new Error('manifest recipe');
if(urlShape('https://pacs.example/blob/12345?id=x')!==urlShape('https://pacs.example/blob/98765?id=y'))throw new Error('dynamic path shape');
const djson=[{'00080018':{vr:'UI',Value:['1.2.3']},'0020000D':{vr:'UI',Value:['1.2']},'0020000E':{vr:'UI',Value:['1.2.1']}}];
if(!looksLikeDicomJson(djson))throw new Error('DICOM JSON fingerprint');
console.log('Generic discovery tests OK');
