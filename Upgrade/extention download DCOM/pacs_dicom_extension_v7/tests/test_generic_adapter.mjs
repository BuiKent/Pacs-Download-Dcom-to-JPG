import {GenericAdapter} from '../lib/adapters/generic.js';
const state={genericProfile:{patientName:'TEST PATIENT',patientId:'PX',studyDate:'20260815',studyUid:'1.2.3'},genericEntries:[
 {url:'https://x.test/a',method:'POST',requestBody:{kind:'raw',chunks:['e30=']},contentType:'application/json',declared:{studyUid:'1.2.3',seriesUid:'1.2.3.1',seriesNumber:'1',seriesDescription:'AX',sopInstanceUid:'1.2.3.1.1',instanceNumber:'1'}},
 {url:'https://x.test/b',method:'GET',declared:{studyUid:'1.2.3',seriesUid:'1.2.3.1',seriesNumber:'1',seriesDescription:'AX',sopInstanceUid:'1.2.3.1.2',instanceNumber:'2'}},
 {url:'https://x.test/c',method:'GET',declared:{studyUid:'1.2.3',seriesUid:'1.2.3.2',seriesNumber:'2',seriesDescription:'SAG',sopInstanceUid:'1.2.3.2.1',instanceNumber:'1'}}
]};
const ctx={state,normalizeStudy:x=>x,headersForUrl:()=>({'X-Test':'1'})};
if(!GenericAdapter.match({},state))throw new Error('generic match');
const inv=await GenericAdapter.analyze(ctx);if(inv.series.length!==2||inv.patient.id!=='PX')throw new Error('generic inventory grouping');
const selected=[inv.series[0].id];const tasks=await GenericAdapter.enumerate(inv,selected,ctx);if(tasks.length!==2)throw new Error('generic series selection');
if(tasks[0].method!=='POST'||!tasks[0].requestBody)throw new Error('POST request template not preserved');
if(!tasks.every(t=>t.studyUid==='1.2.3'&&t.seriesUid==='1.2.3.1'))throw new Error('generic identity mapping');
console.log('Generic adapter tests OK');
