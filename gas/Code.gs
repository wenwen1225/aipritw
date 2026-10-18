/**
 * 掉卡順序紀錄器 — Google Sheets 後端 v1
 * 1. 在全新 Google Sheets → 擴充功能 → Apps Script 貼上本檔。
 * 2. 執行 setupCloud() 並授權；在執行記錄複製「同步金鑰」。
 * 3. 部署 → 新增部署 → 網頁應用程式 → 以我執行 → 任何人。
 * 4. 複製 /exec URL；在網站雲端設定填入網址和同步金鑰。
 * 注意：持有 /exec URL 及金鑰的人可讀寫資料。勿將金鑰貼到 GitHub。
 */
const META = '遊玩局數總覽';
const ITEMS = '完整掉卡紀錄';
const META_HEAD = ['局數 ID','開始時間','結束時間','總張數','左道張數','右道張數','簽卡張數','四星張數','狀態','同步時間'];
const ITEM_HEAD = ['局數 ID','順序','道別','卡號','星等','簽卡','四星前普卡數','四星前普卡卡號','掉卡時間'];
function setupCloud() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book) throw new Error('請從新建立的 Google Sheets 開啟 Apps Script');
  [ [META,META_HEAD], [ITEMS,ITEM_HEAD] ].forEach(([name,head]) => {
    const s=book.getSheetByName(name)||book.insertSheet(name);
    if(s.getLastRow()===0) {s.getRange(1,1,1,head.length).setValues([head]);s.setFrozenRows(1);}
  });
  const props=PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID',book.getId());
  if(!props.getProperty('SYNC_KEY'))props.setProperty('SYNC_KEY',Utilities.getUuid()+'-'+Utilities.getUuid());
  Logger.log('同步金鑰（請勿公開）：'+props.getProperty('SYNC_KEY'));
}
function sheets_() {
  const id=PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if(!id)throw new Error('尚未執行 setupCloud');
  const ss=SpreadsheetApp.openById(id);
  return {meta:ss.getSheetByName(META),items:ss.getSheetByName(ITEMS)};
}
function authorize_(key) {
  const expected=PropertiesService.getScriptProperties().getProperty('SYNC_KEY');
  if(!expected||String(key||'')!==expected)throw new Error('同步金鑰錯誤');
}
function escapeCell_(value) {
  const str=String(value==null?'':value);
  return /^[=+\-@\t\r]/.test(str)?("'"+str):str;
}
function validSession_(s) {
  if(!s || typeof s.id!=='string' || s.id.length>150 || !Array.isArray(s.records) || s.records.length>3000)throw new Error('遊玩紀錄格式錯誤');
  if(isNaN(Date.parse(s.startedAt))||isNaN(Date.parse(s.endedAt)))throw new Error('日期格式錯誤');
  s.records.forEach(r=>{
    if(!/^(00[1-9]|0[1-4][0-9]|05[0-6])$/.test(String(r.card))||!['left','right'].includes(r.lane)||isNaN(Date.parse(r.time)))throw new Error('卡片資料格式錯誤');
  });
}
function sessions_() {
  const {meta,items}=sheets_();
  const summary=meta.getDataRange().getValues().slice(1);
  const details=items.getDataRange().getValues().slice(1);
  const byId={};
  summary.forEach(r=>{const id=String(r[0]);if(r[8]==='active')byId[id]={id,startedAt:String(r[1]),endedAt:String(r[2]),records:[]};});
  details.forEach(r=>{
    const id=String(r[0]),s=byId[id];if(!s)return;
    s.records.push({card:String(r[3]).padStart(3,'0'),lane:r[2]==='左'?'left':'right',rarity:r[4]==='4★'?'four':r[4]==='3★'?'three':'two',signed:r[5]==='是',time:String(r[8]),_order:Number(r[1])});
  });
  return Object.values(byId).map(s=>{s.records.sort((a,b)=>a._order-b._order).forEach(r=>delete r._order);return s;}).sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
}
function saveSession_(session) {
  validSession_(session);
  const {meta,items}=sheets_();
  const values=meta.getDataRange().getValues();
  const rowIndex=values.findIndex((r,i)=>i>0&&String(r[0])===session.id);
  if(rowIndex>=0) {
    if(values[rowIndex][8]==='deleted')return; // 刪除優先：避免離線裝置重新上傳
    return; // idempotent
  }
  const rs=session.records,track={left:{n:0,c:[]},right:{n:0,c:[]}};
  const rows=rs.map((r,i)=>{
    const lane=track[r.lane],four=Number(r.card)<=19,normal=!four&&!r.signed;
    const count=four?lane.n:'',cards=four?lane.c.join(' → '):'';
    if(four){lane.n=0;lane.c=[];} else if(normal){lane.n++;lane.c.push(r.card);}
    return [escapeCell_(session.id),i+1,r.lane==='left'?'左':'右',escapeCell_(r.card),four?'4★':Number(r.card)<=40?'3★':'2★',r.signed?'是':'否',count,cards,escapeCell_(r.time)];
  });
  const now=new Date().toISOString();
  meta.appendRow([escapeCell_(session.id),escapeCell_(session.startedAt),escapeCell_(session.endedAt),rs.length,rs.filter(r=>r.lane==='left').length,rs.filter(r=>r.lane==='right').length,rs.filter(r=>r.signed).length,rs.filter(r=>Number(r.card)<=19).length,'active',now]);
  if(rows.length)items.getRange(items.getLastRow()+1,1,rows.length,ITEM_HEAD.length).setValues(rows);
}
function deleteSession_(id) {
  const {meta}=sheets_();
  const arr=meta.getDataRange().getValues();
  const index=arr.findIndex((r,i)=>i>0&&String(r[0])===id);
  if(index>=0){meta.getRange(index+1,9).setValue('deleted');return;}
  meta.appendRow([escapeCell_(id),'','',0,0,0,0,0,'deleted',new Date().toISOString()]);
}
function doPost(e) {
  try {
    // Supports both legacy JSON body and cross-origin HTML form submission.
    const raw=(e.parameter&&e.parameter.payload)||e.postData.contents;
    const p=JSON.parse(raw);
    authorize_(p.key);
    const lock=LockService.getScriptLock();lock.waitLock(25000);
    try{
      if(p.action==='save')saveSession_(p.session);
      else if(p.action==='delete')deleteSession_(String(p.id));
      else throw new Error('不支援的操作');
    }finally{lock.releaseLock();}
    return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON);
  }catch(err){console.error('doPost 寫入失敗: '+String(err.stack||err));return ContentService.createTextOutput(JSON.stringify({ok:false,error:String(err.message)})).setMimeType(ContentService.MimeType.JSON);}
}
function doGet(e) {
  const cb=String(e.parameter.callback||'');
  if(!/^cloudCallback_[A-Za-z0-9_]+$/.test(cb))return ContentService.createTextOutput('invalid callback');
  let result;
  try {
    authorize_(e.parameter.key);
    if(e.parameter.action!=='list')throw new Error('不支援的查詢');
    const {meta}=sheets_();
    const deleted=meta.getDataRange().getValues().slice(1).filter(r=>r[8]==='deleted').map(r=>String(r[0]));
    result={ok:true,sessions:sessions_(),deleted};
  }catch(err){result={ok:false,error:String(err.message)};}
  return ContentService.createTextOutput(cb+'('+JSON.stringify(result)+');').setMimeType(ContentService.MimeType.JAVASCRIPT);
}
