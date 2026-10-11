const products = window.PRODUCTS;
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
let saved;
try { saved = new Set(JSON.parse(localStorage.getItem('bgt-saved') || '[]').filter((id) => products.some((p) => p.id === id))); } catch { saved = new Set(); }
let category = '全部';
let activeProduct = null;
let toastTimer;
const bookmark = '<svg viewBox="0 0 16 20" aria-hidden="true"><path d="M3 2h10v16l-5-3-5 3z"/></svg>';
const categories = ['全部', ...new Set(products.map((p) => p.category))];
$('#country').innerHTML = '<option value="all">全部制造地</option>' + [...new Set(products.map(p => p.country))].map(country => `<option value="${escapeHtml(country)}">${escapeHtml(country)}</option>`).join('');
$('#total-count').textContent = String(products.length).padStart(2, '0');
$('#categories').innerHTML = categories.map((name) => `<button class="category${name === category ? ' active' : ''}" data-category="${escapeHtml(name)}" aria-pressed="${name === category}">${escapeHtml(name)}</button>`).join('');
function updateSavedCount() {
  $('#saved-count').textContent = saved.size;
  $('#saved-nav').classList.toggle('active', $('#saved-only').checked);
}
function render() {
  const query = $('#search').value.trim().toLocaleLowerCase();
  const country = $('#country').value;
  const matches = products.filter((p) => (category === '全部' || p.category === category) && (country === 'all' || p.country === country) && (!$('#saved-only').checked || saved.has(p.id)) && [p.brand,p.name,p.model,p.material,p.country,p.category].join(' ').toLocaleLowerCase().includes(query));
  $('#result-count').textContent = `${matches.length} 份档案`;
  $('#empty').hidden = matches.length > 0;
  $('#product-grid').innerHTML = matches.map((p, index) => `<article class="product-card">
    <div class="product-visual"><span class="product-number">BGT / ${String(products.indexOf(p)+1).padStart(3,'0')}</span><button class="product-image-button" data-detail="${p.id}" aria-label="查看${escapeHtml(p.name)}档案"><img class="product-image" src="./assets/${p.image}" alt="${escapeHtml(p.brand+' '+p.name)}" loading="${index < 3 ? 'eager' : 'lazy'}" ${index === 0 ? 'fetchpriority="high"' : ''} width="400" height="300"></button><button class="save-button" data-save="${p.id}" aria-label="${saved.has(p.id)?'取消收藏':'收藏'}${escapeHtml(p.name)}" aria-pressed="${saved.has(p.id)}">${bookmark}</button></div>
    <div class="product-info"><div class="card-topline"><span class="product-brand">${escapeHtml(p.brand)}</span><span class="country-label">${escapeHtml(p.country)}${p.originLevel==='brand'?' · 品牌资料':'制造'}</span></div><button class="product-title" data-detail="${p.id}">${escapeHtml(p.name)}</button><p class="material-label">${escapeHtml(p.material)}</p><div class="card-evidence"><div><span>制造依据</span><span>${escapeHtml(p.originScope)}</span></div><div><span>品质状态</span><span>${p.status==='品质审定'?'已审定（见范围）':'待独立核验'}</span></div></div><div class="card-bottom"><span class="archive-status">${escapeHtml(p.status)}</span><button class="detail-link" data-detail="${p.id}">查看档案 <span aria-hidden="true">→</span></button></div></div>
  </article>`).join('');
  updateSavedCount();
}
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 2200);
}
function toggleSave(id) {
  saved.has(id) ? saved.delete(id) : saved.add(id);
  let persisted = true;
  try { localStorage.setItem('bgt-saved', JSON.stringify([...saved])); } catch { persisted = false; }
  render();
  updateDetailSave();
  toast(persisted ? (saved.has(id) ? '已收藏到此浏览器' : '已取消收藏') : '已更新收藏，当前浏览器无法持久保存');
}
function updateDetailSave() {
  const button = $('#detail-dialog .save-detail');
  if (button && activeProduct) {
    button.setAttribute('aria-pressed', saved.has(activeProduct));
    button.textContent = saved.has(activeProduct) ? '已收藏 ✓' : '收藏档案 +';
  }
}
function showDetail(id) {
  const p = products.find((item) => item.id === id);
  if (!p) return;
  activeProduct = id;
  $('#detail-content').innerHTML = `<div class="detail-cover"><img src="./assets/${p.image}" alt="${escapeHtml(p.name)}"></div><div class="detail-body"><div class="detail-brand">${escapeHtml(p.brand)}</div><div class="detail-heading"><h2 id="detail-title">${escapeHtml(p.name)}</h2><button class="save-detail" data-save="${p.id}" aria-pressed="false">收藏档案 +</button></div><div class="detail-model">${escapeHtml(p.model)}</div><dl class="detail-facts"><div><dt>制造地资料</dt><dd>${escapeHtml(p.country)}${p.originLevel==='brand'?' · 品牌级说明':''}</dd></div><div><dt>材质</dt><dd>${escapeHtml(p.material)}</dd></div><div><dt>档案类别</dt><dd>${escapeHtml(p.category)}</dd></div></dl><div class="detail-section"><h3>物品记录</h3><p>${escapeHtml(p.description)}</p></div><div class="detail-section"><h3>资料中已确认</h3><ul>${p.facts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join('')}</ul></div><div class="detail-section"><h3>使用与核验边界</h3><p>${escapeHtml(p.limitation)}</p></div><div class="evidence"><h3>资料依据 <span class="status">${escapeHtml(p.status)}</span></h3><p>来源：${escapeHtml(p.source)}</p><p>制造地依据范围：${escapeHtml(p.originScope)}</p><p>查阅日期：${p.checked}</p><p>待补充：${escapeHtml(p.pending)}</p><p>${p.status==='品质审定'?'本档案已按记录的证据范围完成品质审定，不构成具体批次的正品保证。':'本档案未完成独立品质核验，不构成正品或品质认证。'}${p.exceptionReviewed?'例外说明：'+escapeHtml(p.exceptionNote)+'。':''}图片为品牌资料图，具体款式以文字型号为准。</p></div></div>`;
  updateDetailSave();
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
  $('#detail-content').scrollTop = 0;
}
$('#categories').addEventListener('click', (event) => {
  const button = event.target.closest('[data-category]');
  if (!button) return;
  category = button.dataset.category;
  $('#categories').querySelectorAll('button').forEach((item) => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', item === button); });
  render();
});
document.addEventListener('click', (event) => {
  const save = event.target.closest('[data-save]');
  if (save) { toggleSave(save.dataset.save); return; }
  const detail = event.target.closest('[data-detail]');
  if (detail) showDetail(detail.dataset.detail);
});
['search','country','saved-only'].forEach((id) => $(`#${id}`).addEventListener(id === 'search' ? 'input' : 'change', render));
$('#saved-nav').addEventListener('click', () => {
  $('#saved-only').checked = !$('#saved-only').checked;
  render();
  $('#archive').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
});
$('#reset-filters').addEventListener('click', () => {
  $('#search').value = ''; $('#country').value = 'all'; $('#saved-only').checked = false;
  category = '全部';
  $('#categories').querySelectorAll('button').forEach((item) => { const active = item.dataset.category === category; item.classList.toggle('active',active); item.setAttribute('aria-pressed',active); });
  render();
});
['standards-nav','standards-more'].forEach((id) => $(`#${id}`).addEventListener('click', () => $('#standards-dialog').showModal()));
document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
});
render();
