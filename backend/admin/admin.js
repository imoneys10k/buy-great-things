const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stateNames={draft:'草稿',review:'待编辑审核',approved:'审核通过 · 待发布',published:'已公开',withdrawn:'待撤回 / 已撤回'};
const releaseNames={preparing:'准备公开内容',syncing:'同步 GitHub',synced:'已同步 · 部署待确认',deployed:'已部署',deployment_failed:'部署失败',failed:'发布失败'};
let config,products=[],assets=[],current=null,dirty=false,setup=false,pollTimer,toastTimer,activeTab='catalog',busy=false;
const today=()=>new Date().toLocaleDateString('sv-SE');
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4000);}
async function api(url,{method='GET',data}={}){
  const response=await fetch(url,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-BGT-Request':'1'},...(data?{body:JSON.stringify(data)}:{})});
  const result=await response.json();if(!response.ok){if(response.status===401&&url!=='/api/login')await initialize();throw Error(result.error??'请求失败');}return result;
}
async function action(fn){if(busy){toast('后台正在保存，请稍候再操作');return;}busy=true;$('#app').setAttribute('aria-busy','true');$('#app').inert=true;try{await fn();}catch(error){toast(error.message);}finally{busy=false;$('#app').setAttribute('aria-busy','false');$('#app').inert=false;}}
function markDirty(value){dirty=value;$('#dirty-label').textContent=value?'有未保存修改':'';}
function mayNavigate(){if(dirty){toast('有未保存修改，请先保存或恢复已保存内容');return false;}return true;}
function showPanel(name){$('#editor').hidden=name!=='editor';$('#releases').hidden=name!=='releases';$('#welcome').hidden=name!=='welcome';activeTab=name==='releases'?'releases':'catalog';$('#catalog-tab').classList.toggle('active',activeTab==='catalog');$('#release-tab').classList.toggle('active',activeTab==='releases');if(activeTab!=='releases'){clearTimeout(pollTimer);pollTimer=null;}}
function fillOptions(select,entries,empty){select.innerHTML=(empty?`<option value="">${esc(empty)}</option>`:'')+entries.map(([value,label])=>`<option value="${esc(value)}">${esc(label)}</option>`).join('');}
function assetOptions(){
  const previous=$('#image-select').value,previousAttachment=$('#attachment-select').value;
  fillOptions($('#image-select'),assets.filter(a=>a.kind==='image').map(a=>[a.name,a.name]),'请选择图片');
  fillOptions($('#attachment-select'),assets.filter(a=>a.kind==='evidence').map(a=>[a.id,a.name]),'无附件');
  $('#image-select').value=previous;$('#attachment-select').value=previousAttachment;
}
function renderList(){
  const query=$('#list-search').value.trim().toLowerCase();
  const items=products.filter(p=>`${p.document.brand} ${p.document.name} ${p.id}`.toLowerCase().includes(query));
  $('#product-list').innerHTML=items.map(p=>`<button class="product-list-item${p.id===current?.id?' active':''}" data-product="${esc(p.id)}"><strong>${esc(p.document.name||p.id)}</strong><span>${esc(stateNames[p.state])}<span>v${p.revision}</span></span></button>`).join('')||'<p class="empty-text">没有匹配档案</p>';
  $('#category-options').innerHTML=[...new Set(products.map(p=>p.document.category).filter(Boolean))].map(value=>`<option value="${esc(value)}"></option>`).join('');
}
async function refreshProducts(){products=await api('/api/products');renderList();}
function imagePreview(){const name=$('#image-select').value;$('#product-image').hidden=!name;if(name)$('#product-image').src=`/api/images/${encodeURIComponent(name)}`;}
function exceptionFields(){$('#exception-fields').hidden=$('#country-code').value!=='CN';}
function editorDocument(){const data=Object.fromEntries(new FormData($('#product-form')));if(current?.id)data.id=current.id;for(const key of ['facts','comparators'])data[key]=data[key].split('\n').map(s=>s.trim()).filter(Boolean);return data;}
async function openProduct(id){
  current=await api(`/api/products/${id}`);showEditor();await history();renderList();
}
function showEditor(){
  showPanel('editor');markDirty(false);const d=current.document;
  $('#product-form').reset();
  for(const [key,value] of Object.entries(d)){const field=$('#product-form').elements.namedItem(key);if(field)field.value=Array.isArray(value)?value.join('\n'):value??'';}
  $('#product-form').elements.id.disabled=!!current.id;
  $('#editor-title').textContent=d.name||'新建档案';$('#editor-reference').textContent=current.id?`${current.id} / v${current.revision}`:'NEW ARCHIVE';$('#editor-state').textContent=stateNames[current.state];
  $('#editor-notice').textContent=current.live?'此档案已有公开版本。保存修改会产生草稿，上次公开版本保持原样。':'这是一份私有草稿，审核并发布后才会出现在公开网站。';
  $('#approve').disabled=current.state!=='review';$('#reject').disabled=!['review','approved'].includes(current.state);$('#withdraw').disabled=!current.live;
  imagePreview();exceptionFields();renderEvidence();resetEvidence();$('#review-note').value='';
  const issues=current.issues??[];$('#review-issues').innerHTML=issues.length?`<ul>${issues.map(issue=>`<li>${esc(issue)}</li>`).join('')}</ul>`:'资料字段与证据类型已满足审核条件；仍需管理员核对实际内容。';
}
function newProduct(){
  current={id:null,revision:0,state:'draft',evidence:[],issues:['新建档案请先保存草稿'],document:{id:'',brand:'',name:'',model:'',category:'',countryCode:'UNKNOWN',material:'',checked:today(),image:'',description:'',facts:[],limitation:'',source:'',originLevel:'model',originScope:'',qualityIntent:'pending',pending:'',qualityNote:'',comparators:[],exceptionReason:'',exceptionNote:'',notes:''}};
  showEditor();$('#history').innerHTML='<p class="empty-text">保存后开始记录版本。</p>';renderList();
}
async function saveEditor(){
  const d=editorDocument();current=await api(current.id?`/api/products/${current.id}`:'/api/products',{method:current.id?'PUT':'POST',data:{document:d,revision:current.revision}});
  current=await api(`/api/products/${current.id}`);showEditor();await refreshProducts();await history();
}
function renderEvidence(){
  $('#evidence-count').textContent=`${current.evidence.length} 条`;
  $('#evidence-list').innerHTML=current.evidence.map(e=>`<article class="evidence-item"><h3>${esc(e.title)}</h3><p class="meta">${esc(config.evidenceTypes[e.type])} / ${e.sourceType==='independent'?'独立来源':'厂商陈述'} / ${esc(e.checked)}</p><p>${esc(e.summary)}</p>${e.url?`<p class="source-url">${esc(e.url)}</p>`:''}${e.attachment?`<a href="/api/attachments/${esc(e.attachment)}">下载证据附件</a>`:''}<div class="inline-actions"><button data-edit-evidence="${esc(e.id)}">编辑证据</button><button data-remove-evidence="${esc(e.id)}">移除引用</button></div></article>`).join('')||'<p class="empty-text">尚未记录证据。</p>';
}
function resetEvidence(){$('#evidence-form').reset();$('#evidence-form').elements.checked.value=today();$('#evidence-form').elements.evidenceId.value='';$('#evidence-submit').textContent='添加证据';}
async function history(){
  const result=await api(`/api/products/${current.id}/history`);
  $('#history').innerHTML=result.revisions.map(r=>`<article class="history-item"><div><h3>版本 ${r.revision}</h3><p>${esc(r.note)}</p><p class="meta">${esc(r.actor)} / ${esc(new Date(r.created_at).toLocaleString())}</p></div><button data-restore="${r.revision}">恢复为草稿</button></article>`).join('')+result.reviews.map(r=>`<article class="history-item"><div><h3>${esc({submit:'提交审核',approve:'审核通过',reject:'退回草稿',withdraw:'撤回公开档案'}[r.decision])} / v${r.revision}</h3><p>${esc(r.note)}</p><p class="meta">${esc(r.actor)} / ${esc(new Date(r.created_at).toLocaleString())}</p></div></article>`).join('');
}
async function upload(file,kind){
  if(!file)return null;if(file.size>8*1024*1024)throw Error('附件必须小于 8 MB');
  const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Error('无法读取文件'));reader.readAsDataURL(file);});
  const result=await api('/api/assets',{method:'POST',data:{kind,name:file.name,mime:file.type,data}});assets=await api('/api/assets');assetOptions();return result;
}
async function refreshReleases(){
  clearTimeout(pollTimer);const [preview,state]=await Promise.all([api('/api/preview'),api('/api/releases')]);
  await refreshProducts();
  $('#release-preview').innerHTML=preview.changes.length?preview.changes.map(p=>`<div class="preview-change"><span>${esc(p.name)}</span><span>${esc(p.action)}</span></div>`).join(''):'<p class="empty-text">没有新审核或撤回的变更。发布将使用当前公开版本。</p>';
  $('#publish').disabled=state.publishing;$('#publish-status').textContent=state.publishing?'正在发布，请等待状态更新':`本次公开 ${preview.products.length} 份档案`;
  $('#release-list').innerHTML=state.releases.map(r=>`<article class="release-item"><h3>${esc(releaseNames[r.status])}</h3><p class="meta">${esc(new Date(r.created_at).toLocaleString())}</p>${r.commit_sha?`<p class="sha">${esc(r.commit_sha.slice(0,12))}</p>`:''}${r.error?`<p class="error">${esc(r.error)}</p>`:''}${r.status==='deployed'?'<p class="meta">公开网站已更新。</p>':''}</article>`).join('')||'<p class="empty-text">尚无后台发布记录。</p>';
  if(activeTab==='releases'&&(state.publishing||state.releases.some(r=>r.status==='synced'&&!r.error)))pollTimer=setTimeout(()=>refreshReleases().catch(e=>toast(e.message)),3000);
}
async function initialize(){
  clearTimeout(pollTimer);const session=await api('/api/session');setup=session.needsSetup;
  $('#auth').hidden=session.authenticated;$('#app').hidden=!session.authenticated;
  if(!session.authenticated){
    $('#auth-title').textContent=setup?'创建内容管理员':'登录内容管理';$('#auth-submit').textContent=setup?'创建并进入后台':'登录';$('#name-label').hidden=!setup;$('#password-hint').hidden=!setup;
    $('#auth-form').elements.password.minLength=setup?12:1;$('#auth-form').elements.password.autocomplete=setup?'new-password':'current-password';return;
  }
  $('#admin-name').textContent=session.name;config=await api('/api/config');assets=await api('/api/assets');
  fillOptions($('#country-code'),Object.entries(config.countries));fillOptions($('#origin-level'),Object.entries(config.originLevels));fillOptions($('#evidence-type'),Object.entries(config.evidenceTypes));assetOptions();
  await refreshProducts();current=null;markDirty(false);showPanel('welcome');
}
$('#auth-form').addEventListener('submit',event=>{event.preventDefault();void action(async()=>{const input=Object.fromEntries(new FormData(event.target));$('#auth-error').textContent='';try{await api(setup?'/api/setup':'/api/login',{method:'POST',data:input});event.target.reset();await initialize();}catch(e){$('#auth-error').textContent=e.message;}});});
$('#logout').addEventListener('click',()=>{if(mayNavigate())void action(async()=>{await api('/api/logout',{method:'POST'});await initialize();});});
$('#list-search').addEventListener('input',renderList);
$('#new-product').addEventListener('click',()=>{if(mayNavigate())newProduct();});
$('#catalog-tab').addEventListener('click',()=>{if(mayNavigate()){if(current?.id)void action(()=>openProduct(current.id));else showPanel(current?'editor':'welcome');}});
$('#release-tab').addEventListener('click',()=>{if(mayNavigate())void action(async()=>{showPanel('releases');await refreshReleases();});});
$('#product-form').addEventListener('input',()=>markDirty(true));
$('#country-code').addEventListener('change',exceptionFields);$('#image-select').addEventListener('change',imagePreview);
$('#product-form').addEventListener('submit',event=>{event.preventDefault();void action(async()=>{await saveEditor();toast('草稿已保存');});});
$('#submit-review').addEventListener('click',()=>void action(async()=>{await saveEditor();await api(`/api/products/${current.id}/submit`,{method:'POST',data:{revision:current.revision,note:'提交当前资料与证据进行编辑审核'}});await openProduct(current.id);await refreshProducts();toast('已提交审核');}));
$('#discard').addEventListener('click',()=>void action(async()=>{if(current.id)await openProduct(current.id);else newProduct();toast('已恢复已保存内容');}));
for(const kind of ['approve','reject','withdraw'])$(`#${kind}`).addEventListener('click',()=>void action(async()=>{
  if(dirty)throw Error('请先保存修改，并重新提交审核');if(!current.id)throw Error('请先保存档案');
  await api(`/api/products/${current.id}/${kind}`,{method:'POST',data:{revision:current.revision,note:$('#review-note').value}});await openProduct(current.id);await refreshProducts();toast({approve:'审核通过，等待发布',reject:'已退回草稿',withdraw:'已标记撤回，发布后从网站移除'}[kind]);
}));
$('#image-upload').addEventListener('change',event=>void action(async()=>{const result=await upload(event.target.files[0],'image');if(result){$('#image-select').value=result.name;markDirty(true);imagePreview();toast('图片已保存到私有后台，审核发布后才会公开');}event.target.value='';}));
$('#attachment-upload').addEventListener('change',event=>void action(async()=>{const result=await upload(event.target.files[0],'evidence');if(result){$('#attachment-select').value=result.id;toast('证据附件已保存到本机');}event.target.value='';}));
$('#evidence-form').addEventListener('submit',event=>{event.preventDefault();void action(async()=>{
  if(!current.id)throw Error('请先保存商品档案');if(dirty)throw Error('请先保存商品信息');
  const evidence=Object.fromEntries(new FormData(event.target));const id=evidence.evidenceId;delete evidence.evidenceId;
  await api(`/api/products/${current.id}/evidence${id?`/${id}`:''}`,{method:id?'PUT':'POST',data:{revision:current.revision,evidence}});await openProduct(current.id);await refreshProducts();toast('证据已保存，档案已回到草稿状态');
});});
$('#evidence-cancel').addEventListener('click',resetEvidence);
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.product&&mayNavigate())void action(()=>openProduct(button.dataset.product));
  if(button.dataset.restore)void action(async()=>{if(!mayNavigate())return;await api(`/api/products/${current.id}/restore`,{method:'POST',data:{revision:current.revision,version:Number(button.dataset.restore)}});await openProduct(current.id);await refreshProducts();toast('历史资料与证据已恢复为草稿');});
  if(button.dataset.editEvidence){const e=current.evidence.find(x=>x.id===button.dataset.editEvidence);if(!e)return;for(const [key,value]of Object.entries(e)){const field=$('#evidence-form').elements.namedItem(key==='id'?'evidenceId':key);if(field)field.value=value??'';}$('#evidence-submit').textContent='保存证据修改';$('#evidence-form').scrollIntoView({behavior:'instant'});}
  if(button.dataset.removeEvidence)void action(async()=>{if(dirty)throw Error('请先保存商品信息');await api(`/api/products/${current.id}/evidence/${button.dataset.removeEvidence}`,{method:'DELETE',data:{revision:current.revision}});await openProduct(current.id);await refreshProducts();toast('证据引用已移除，历史版本保留');});
});
$('#refresh-releases').addEventListener('click',()=>void action(refreshReleases));
$('#publish').addEventListener('click',()=>void action(async()=>{await api('/api/releases',{method:'POST',data:{}});await refreshReleases();toast('发布任务已启动');}));
$('#backup').addEventListener('click',()=>void action(async()=>{const result=await api('/api/backup',{method:'POST',data:{}});toast(result.message);}));
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
void initialize().catch(error=>toast(error.message));
