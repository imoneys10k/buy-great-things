import assert from 'node:assert/strict';

export const COUNTRIES = {JP:'日本',FR:'法国',DE:'德国',GB:'英国',CH:'瑞士',CN:'中国',US:'美国',IT:'意大利',SE:'瑞典',DK:'丹麦',NO:'挪威',FI:'芬兰',AT:'奥地利',NL:'荷兰',ES:'西班牙',PT:'葡萄牙',CA:'加拿大',AU:'澳大利亚',NZ:'新西兰',BE:'比利时',CZ:'捷克',PL:'波兰',KR:'韩国',SG:'新加坡',IN:'印度',TH:'泰国',VN:'越南',ID:'印度尼西亚',MY:'马来西亚',MX:'墨西哥',UNKNOWN:'待确认'};
export const ORIGIN_LEVELS = {brand:'品牌级说明',series:'系列制造说明',model:'具体型号说明',batch:'具体批次说明'};
export const EVIDENCE_TYPES = {origin:'制造地',material:'材质与工艺',quality:'独立品质测试',long_term:'长期使用',comparison:'同类对照'};
export const PUBLIC_FIELDS = ['id','brand','name','model','category','country','material','image','description','facts','limitation','source','originScope','originLevel','checked','pending','status','exceptionReviewed','exceptionNote'];
export class AppError extends Error { constructor(message, status=400){super(message);this.status=status;} }
export function requireThat(condition,message,status=400){if(!condition)throw new AppError(message,status);}
export function text(value,max=2000){requireThat(typeof value==='string','文字字段格式不正确');requireThat(value.length<=max,'文字字段过长');requireThat(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value),'文字包含无效控制字符');return value.trim();}
export function date(value){const result=text(value,10);const parsed=new Date(result);requireThat(/^\d{4}-\d{2}-\d{2}$/.test(result)&&Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===result,'日期必须为有效的 YYYY-MM-DD');return result;}
export function slug(value){const result=text(value,80);requireThat(/^[a-z0-9][a-z0-9-]*$/.test(result),'编号只允许小写字母、数字和连字符');return result;}
export function imageName(value){const result=text(value,120);requireThat(/^[a-z0-9][a-z0-9-]*\.webp$/.test(result),'图片必须为本地 WebP 文件名');return result;}
export function normalizeDocument(input){
  requireThat(input&&typeof input==='object'&&!Array.isArray(input),'档案格式不正确');
  const result={id:slug(input.id)};
  for(const key of ['brand','name','model','category','material','description','limitation','source','originScope','pending','exceptionNote']){
    result[key]=text(input[key]??'',key==='description'||key==='limitation'||key==='pending'?3000:600);
    requireThat(!/https?:\/\//i.test(result[key]),'公开文字不包含网址；请将原始网址填入证据记录');
  }
  result.image=input.image?imageName(input.image):'';
  result.checked=input.checked?date(input.checked):'';
  requireThat(Array.isArray(input.facts??[])&&(input.facts??[]).length<=30,'已确认信息格式不正确');
  result.facts=(input.facts??[]).map(item=>{const v=text(item,1000);requireThat(!/https?:\/\//i.test(v),'公开信息不包含网址');return v;}).filter(Boolean);
  result.countryCode=input.countryCode??'UNKNOWN';requireThat(Object.hasOwn(COUNTRIES,result.countryCode),'请选择有效制造地');
  result.country=COUNTRIES[result.countryCode];
  result.originLevel=input.originLevel??'model';requireThat(Object.hasOwn(ORIGIN_LEVELS,result.originLevel),'制造依据层级不正确');
  result.qualityIntent=input.qualityIntent??'pending';requireThat(['pending','verified'].includes(result.qualityIntent),'品质状态不正确');
  result.qualityNote=text(input.qualityNote??'',3000);result.exceptionReason=text(input.exceptionReason??'',3000);result.notes=text(input.notes??'',5000);
  requireThat(Array.isArray(input.comparators??[])&&(input.comparators??[]).length<=20,'同类对照格式不正确');
  result.comparators=(input.comparators??[]).map(item=>text(item,300)).filter(Boolean);
  return result;
}
export function normalizeEvidence(input){
  requireThat(input&&typeof input==='object','证据格式不正确');
  const e={type:input.type,sourceType:input.sourceType,title:text(input.title??'',600),summary:text(input.summary??'',5000),url:text(input.url??'',2000),checked:date(input.checked),attachment:input.attachment?slug(input.attachment):null};
  requireThat(Object.hasOwn(EVIDENCE_TYPES,e.type),'证据类别不正确');requireThat(['manufacturer','independent'].includes(e.sourceType),'来源类别不正确');
  requireThat(e.title&&e.summary,'请填写证据标题和实际支持的结论');
  if(e.url){let u;try{u=new URL(e.url);}catch{throw new AppError('来源网址不正确');}requireThat(['https:','http:'].includes(u.protocol)&&!u.username&&!u.password,'来源网址只允许不含凭据的 HTTP/HTTPS');}
  requireThat(e.url||e.attachment,'请提供来源网址或证据附件');return e;
}
export function reviewIssues(d,evidence){
  const issues=[];
  for(const key of ['brand','name','model','category','material','description','limitation','source','originScope','image','checked'])if(!d[key])issues.push(`缺少 ${key}`);
  if(!d.facts.length)issues.push('至少记录一条资料中已确认的信息');
  if(d.countryCode==='UNKNOWN')issues.push('制造地尚未确认');
  if(!evidence.some(e=>e.type==='origin'))issues.push('缺少制造地证据');
  if(d.originLevel==='brand'&&!/品牌/.test(d.originScope))issues.push('品牌级制造说明必须在公开依据范围中明确标注');
  if(d.qualityIntent==='pending'&&!d.pending)issues.push('尚未完成品质核验时，必须填写待补充信息');
  if(d.qualityIntent==='verified'){
    if(!evidence.some(e=>e.type==='quality'&&e.sourceType==='independent'))issues.push('品质审定需要独立测试证据');
    if(!evidence.some(e=>e.type==='long_term'))issues.push('品质审定需要长期使用证据');
    if(d.qualityNote.length<8)issues.push('品质审定需要明确的结论及适用范围');
  }
  if(d.countryCode==='CN'){
    if(d.qualityIntent!=='verified')issues.push('中国制造例外必须完成品质审定');
    if(!evidence.some(e=>e.type==='comparison'&&e.sourceType==='independent'))issues.push('中国制造例外需要独立同类对照证据');
    if(new Set(d.comparators).size<2)issues.push('中国制造例外至少列出两个具体同类对照型号');
    if(d.exceptionReason.length<20||d.exceptionNote.length<8)issues.push('请完整记录品质冠绝的审核理由和公开例外说明');
  }
  return issues;
}
export function publicProduct(d){
  const result={};for(const key of PUBLIC_FIELDS)if(d[key]!==undefined)result[key]=d[key];
  result.status=d.qualityIntent==='verified'?'品质审定':'资料建档';
  result.exceptionReviewed=d.countryCode==='CN';
  if(!result.exceptionReviewed)delete result.exceptionNote;
  return result;
}
export function validatePublic(products){
  assert.ok(Array.isArray(products));assert.equal(new Set(products.map(p=>p.id)).size,products.length,'Duplicate product IDs');
  for(const p of products){
    slug(p.id);imageName(p.image);date(p.checked);
    for(const key of Object.keys(p))assert.ok(PUBLIC_FIELDS.includes(key),`Private field leaked: ${key}`);
    for(const key of ['brand','name','model','category','country','material','description','source','originScope'])assert.ok(typeof p[key]==='string'&&p[key],`${p.id}: missing ${key}`);
    assert.ok(Array.isArray(p.facts));assert.ok(['资料建档','品质审定'].includes(p.status));assert.ok(Object.hasOwn(ORIGIN_LEVELS,p.originLevel));
    assert.ok(!/https?:\/\//i.test(JSON.stringify(p)),'Source URLs must stay in the private evidence store');
    if(p.country==='中国')assert.ok(p.status==='品质审定'&&p.exceptionReviewed===true&&p.exceptionNote?.length>=8,'Chinese origin needs reviewed exception');
  }
  return products;
}
