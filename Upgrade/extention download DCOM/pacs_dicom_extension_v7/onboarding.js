'use strict';
const MODE_KEY='pacs6_permission_mode';
const status=document.getElementById('status');
async function finish(mode,text){await chrome.storage.local.set({[MODE_KEY]:mode});status.textContent=text;setTimeout(()=>window.close(),700);}
document.getElementById('allSitesBtn').addEventListener('click',async()=>{
  try{
    const ok=await chrome.permissions.request({origins:['http://*/*','https://*/*']});
    if(!ok){status.textContent='Chrome chưa cấp quyền.';return;}
    await finish('global','Đã cấp quyền.');
  }catch(e){status.textContent=String(e?.message||e);}
});
document.getElementById('perSiteBtn').addEventListener('click',()=>finish('per-site','Đã chọn cấp quyền từng site.'));
