/* =========================================================
   ESG 披露收资工具 · 前端逻辑
   数据持久化：localStorage（按报告年度归档）
   ========================================================= */

/* ---------------- 存储 ---------------- */
const LS_KEY = 'esgTool.v1';

function loadStore(){
  try{
    const s = JSON.parse(localStorage.getItem(LS_KEY));
    if(s && s.years) return s;
  }catch(e){}
  return {
    meta: { year: String(new Date().getFullYear()) },
    stdSel: ['hkex'],
    ratingSel: [],
    offices: [
      { place:'北京', area:'3217.94', people:'424', note:'' },
      { place:'广州', area:'30', people:'8', note:'' },
      { place:'贵阳', area:'1447', people:'25', note:'' }
    ],
    years: {},   // { '2025': { values: { 'hkex:H2': {v:'', t:''} } } }
    flags: {}    // 待复核标记 { '2025:hkex:H2': true }
  };
}
let store = loadStore();
let saveTimer = null;
function save(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(()=>localStorage.setItem(LS_KEY, JSON.stringify(store)), 200);
}
function yearData(y){
  y = y || store.meta.year || '2025';
  if(!store.years[y]) store.years[y] = { values:{} };
  return store.years[y];
}
const vkey = (std, code) => std + ':' + code;
function getVal(std, code, y){
  return (yearData(y).values[vkey(std, code)]) || {};
}
function isFilled(v){ return !!((v.v && String(v.v).trim()) || (v.t && String(v.t).trim())); }
function flagKey(std, code){ return (store.meta.year||'') + ':' + std + ':' + code; }

/* ---------------- 通用工具 ---------------- */
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }
function shortName(k){
  return { hkex:'港交所ESG守则', mof:'财政部披露准则', exchange:'沪深北指引', issb:'ISSB（S1/S2）' }[k] || k;
}
function stdByName(n){
  const m = { '港交所ESG守则':'hkex', '财政部披露准则':'mof', '沪深北指引':'exchange', 'ISSB（S1/S2）':'issb' };
  if(m[n]) return m[n];
  if(/^H\d/.test(n)) return 'hkex';
  if(/^M\d/.test(n)) return 'exchange';
  if(/^F\d/.test(n)) return 'mof';
  if(/^I\d/.test(n)) return 'issb';
  return null;
}
function countItems(std){ return std.topics.reduce((n,t)=>n+t.items.length, 0); }
function countType(std, type){ return std.topics.reduce((n,t)=>n+t.items.filter(i=>i.type===type).length, 0); }
function countFilled(stdKey){
  let n = 0;
  STANDARDS[stdKey].topics.forEach(t=>t.items.forEach(it=>{ if(isFilled(getVal(stdKey, it.code))) n++; }));
  return n;
}
const STD_ORDER = ['exchange','hkex','mof','issb'];
function selectedStds(){ return STD_ORDER.filter(k=>store.stdSel.includes(k)); }
function selectedRatings(){ return store.ratingSel.slice(); }
function typeInfo(t){
  if(t==='num') return ['t-num','定量'];
  if(t==='text') return ['t-txt','定性'];
  return ['t-mix','定性/定量'];
}
function useTagsHtml(stdKey, code){
  const uses = RATING_MAP[stdKey+':'+code] || [];
  if(!uses.length) return '';
  const selR = selectedRatings();
  return '<span class="use-wrap">同时用于：' + uses.map(u=>'<b class="'+(selR.includes(u)?'on':'')+'">'+u+'</b>').join(' · ') + '</span>';
}
function cardTitle(it){
  const lv2 = it.lv2 ? '<span class="lv2">'+esc(it.lv2)+' › </span>' : '';
  return it.name ? lv2 + '<span class="it-name">'+esc(it.name)+'</span>' : '';
}
function metaHtml(it){
  if(!it.hint) return '';
  return '<div class="hint"><span class="k">填写提示</span>　'+esc(it.hint)+'</div>';
}

/* ---------------- 指标值读写（供内联事件调用） ---------------- */
window.onVal = function(std, code, field, el){
  const k = vkey(std, code), yd = yearData();
  if(!yd.values[k]) yd.values[k] = {};
  yd.values[k][field] = el.value;
  save();
  refreshStatus(std, code);
  refreshProgress();
};
window.toggleFlag = function(std, code){
  const k = flagKey(std, code);
  if(store.flags[k]) delete store.flags[k]; else store.flags[k] = true;
  save();
  refreshStatus(std, code);
  refreshProgress();
};
window.applyPrev = function(std, code){
  const prevY = String(parseInt(store.meta.year) - 1);
  const prev = getVal(std, code, prevY);
  if(!prev.v) return;
  const k = vkey(std, code), yd = yearData();
  if(!yd.values[k]) yd.values[k] = {};
  yd.values[k].v = prev.v;
  save();
  const inp = document.querySelector('[data-in="'+std+':'+code+'"]');
  if(inp) inp.value = prev.v;
  refreshStatus(std, code);
  refreshProgress();
  const yoy = document.querySelector('[data-yoy="'+std+':'+code+'"]');
  if(yoy) yoy.outerHTML = yoyHtml(std, { code: code, unit: (findItem(std, code)||{}).unit });
};
function findItem(std, code){
  let found = null;
  STANDARDS[std].topics.forEach(t=>t.items.forEach(it=>{ if(it.code===code) found = it; }));
  return found;
}
function statusOf(std, code){
  if(store.flags[flagKey(std, code)]) return ['st-check','待复核'];
  return isFilled(getVal(std, code)) ? ['st-done','已填'] : ['st-todo','未填'];
}
function refreshStatus(std, code){
  const el = document.querySelector('[data-st="'+std+':'+code+'"]');
  if(!el) return;
  const [cls, txt] = statusOf(std, code);
  el.className = 'st ' + cls;
  el.textContent = txt;
  el.title = txt==='待复核' ? '点击取消待复核' : '点击标记为待复核';
}

/* ---------------- 进度与区块圆点 ---------------- */
let pillTimer = null;
function refreshProgress(){
  if(inPreview) return;
  const stdKey = activeStd;
  if(!stdKey || !STANDARDS[stdKey]) return;
  const total = countItems(STANDARDS[stdKey]);
  const filled = countFilled(stdKey);
  const reviewing = Object.keys(store.flags).filter(k=>k.indexOf((store.meta.year||'')+':'+stdKey+':')===0).length;
  const slot = document.getElementById('pgSlot');
  if(slot) slot.innerHTML =
    '<div class="progress-wrap"><div class="progress-bar"><i style="width:'+Math.round(filled/total*100)+'%"></i></div>'+
    '<span class="progress-txt">已填 '+filled+' / '+total+' · 待复核 '+reviewing+'</span></div>';
  clearTimeout(pillTimer);
  pillTimer = setTimeout(renderTopicPills, 400);
}
function topicDot(t, stdKey){
  const done = t.items.filter(i=>isFilled(getVal(stdKey, i.code))).length;
  const r = t.items.length ? done/t.items.length : 0;
  return r>=0.99 ? 'dot-g' : r>0 ? 'dot-y' : 'dot-gy';
}

/* ---------------- 输入区渲染 ---------------- */
function inputFor(std, it){
  const v = getVal(std, it.code);
  const id = std + "','" + it.code;
  if(it.type==='num')
    return '<div class="input-line"><input class="input" data-in="'+std+':'+it.code+'" placeholder="填写汇总数值" value="'+esc(v.v||'')+'" oninput="onVal(\''+id+'\',\'v\',this)"><span class="unit">'+esc(it.unit||'')+'</span></div>';
  if(it.type==='text')
    return '<textarea class="ta" data-in="'+std+':'+it.code+'" placeholder="填写汇总后的定性描述（可粘贴要点，系统不做字数限制）" oninput="onVal(\''+id+'\',\'t\',this)">'+esc(v.t||'')+'</textarea>';
  return '<div class="input-line"><input class="input" data-in="'+std+':'+it.code+'" placeholder="定量部分：填写汇总数值" value="'+esc(v.v||'')+'" oninput="onVal(\''+id+'\',\'v\',this)"><span class="unit">'+esc(it.unit||'')+'</span></div>'+
         '<textarea class="ta" data-in-t="'+std+':'+it.code+'" placeholder="定性部分：填写文字描述" oninput="onVal(\''+id+'\',\'t\',this)">'+esc(v.t||'')+'</textarea>';
}
function yoyHtml(std, it){
  const prevY = String(parseInt(store.meta.year) - 1);
  const prev = getVal(std, it.code, prevY);
  const pv = (prev.v||'').trim();
  if(!pv) return '';
  const cur = (getVal(std, it.code).v||'').trim();
  let cmp = '';
  const pn = parseFloat(pv.replace(/,/g,'')), cn = parseFloat(cur.replace(/,/g,''));
  if(!isNaN(pn) && !isNaN(cn) && pn!==0 && cur){
    const d = (cn-pn)/pn*100;
    cmp = ' 同比 ' + (d>=0?'+':'') + d.toFixed(1) + '%' + (Math.abs(d)>30 ? ' <span class="warn">⚠ 波动超±30%，建议备注原因</span>' : '');
  }
  return '<div class="yoy" data-yoy="'+std+':'+it.code+'">上年同期：'+esc(pv)+' '+esc(it.unit||'')+
    ' <span class="ref" onclick="applyPrev(\''+std+"','"+it.code+'\')">↻ 一键引用</span>'+cmp+'</div>';
}

/* ---------------- 视图状态 ---------------- */
let activeStd = null;
let activeTopic = null;
let inPreview = false;
let viewMode = 'topic';   // topic | num | txt | mix

/* 主题组折叠状态（定量批量 / 定性撰写 / 定性定量视图，按 视图|标准|议题序号 记忆） */
const collapsedTopics = new Set();
window.toggleBlkRow = function(tr, key){
  const hide = tr.classList.toggle('off');
  if(hide) collapsedTopics.add(key); else collapsedTopics.delete(key);
  let n = tr.nextElementSibling;
  while(n && !n.classList.contains('blk')){ n.style.display = hide ? 'none' : ''; n = n.nextElementSibling; }
};
window.toggleTopicSec = function(hd, key){
  const hide = hd.parentNode.classList.toggle('collapsed');
  if(hide) collapsedTopics.add(key); else collapsedTopics.delete(key);
};

/* ---------------- 初步诊断缺口 ----------------
   Demo：真实场景由诊断引擎产出，经 localStorage「esgDiagnosis.v1」或导入接入；
   此处内置样例（EcoVadis · 基于 2024 年报），字段与 diagnosis.html 卡片结构一致 */
const DIAGNOSIS_DEMO = {
  std: 'EcoVadis', baseYear: 2024, total: 8, fullCount: 2,
  topics: [
    { key:'气候', name:'应对气候变化', status:'part', gaps:3,
      found:'已有范围 1 排放 116,326.17 tCO₂e、范围 2 排放 1,079,833.21 tCO₂e 的列示；范围 2 核算方法、范围 3 绝对量、限期行动安排与验证信息仍有缺口。',
      gapNames:['31 经验证的碳抵消额度采购','35 燃料替代节能与减排措施','36 碳捕获与储存（CCS）措施'], more:7 },
    { key:'健康与安全', name:'员工安全与发展', status:'part', gaps:3,
      found:'已有雇佣、职业健康安全、培训与员工结构数据；技能培训专门覆盖率、全部培训人均时长、损失工作日及维生工资和条件画像信息仍需补充。',
      gapNames:['145 工作条件政策及目标','146 结社自由与集体谈判政策及目标','148 禁止童工、强迫劳动与人口贩运政策及目标'], more:55 },
    { key:'产品责任', name:'产品和服务安全与质量', status:'part', gaps:3,
      found:'已有质量体系、产品标签和环保认证的依据；健康安全专项量化绩效、召回程序和 SDS 信息未完整列示。',
      gapNames:['27 产品健康与安全政策及目标','91 产品安全应急响应与召回程序','92 产品健康与安全外部反馈机制'], more:0 },
    { key:'数据安全与客户隐私保护', name:'信息安全与客户隐私保护', status:'part', gaps:3,
      found:'已有信息安全制度、分级风险管理、事件处置和培训；第三方数据保护、保存期限、同意机制、事件数量与认证覆盖仍有缺口。',
      gapNames:['15 商业道德相关认证','308 信息安全与数据保护政策及目标','317 第三方信息安全尽职调查'], more:5 },
    { key:'反贪污', name:'反商业贿赂及反贪污', status:'part', gaps:3,
      found:'已有反腐败制度、监督机构、举报保护和干部培训的列示；定量目标、第三方尽调范围、确认案件数与培训覆盖口径未完整列示。',
      gapNames:['15 商业道德相关认证','304 反腐败政策及目标','305 利益冲突管理政策及目标'], more:1 },
    { key:'管治', name:'可持续发展治理', status:'part', gaps:2,
      found:'已有治理职责、气候目标与进度跟踪的原文依据；管理层薪酬与减排目标进度的关联尚未具体说明。',
      gapNames:['134 管理层薪酬与减排目标挂钩机制','139 温室气体减排目标进展及审查结果'], more:0 },
    { key:'利益相关方沟通', name:'利益相关方沟通与重要性评估', status:'full', gaps:0,
      found:'已有识别、影响与财务重要性评估及矩阵，2025 年延续往年评估结果。',
      gapNames:[], more:0 },
    { key:'董事会多元', name:'董事会多元化与独立性', status:'full', gaps:0,
      found:'已有女性董事占比数据：女性董事 1 人、董事 9 人，占比 11.11%。',
      gapNames:[], more:0 }
  ]
};
let DIAGNOSIS = (function(){
  try{ const s = localStorage.getItem('esgDiagnosis.v1'); if(s) return JSON.parse(s); }catch(e){}
  return DIAGNOSIS_DEMO;
})();
let gapsOnly = false;
let diagOpen = false;
const DG_STATUS = { full:'已完整披露', part:'已部分披露', none:'未披露' };
function diagOfTopicName(name){   // 议题级映射：诊断议题关键词命中当前标准的议题名
  if(!DIAGNOSIS) return null;
  return DIAGNOSIS.topics.find(t=> name.indexOf(t.key)>=0 ) || null;
}
function diagGapOfTopicName(name){ const d = diagOfTopicName(name); return (d && d.gaps>0) ? d : null; }
function renderDiagBar(){
  const bar = document.getElementById('diagBar');
  if(!bar) return;
  const d = DIAGNOSIS;
  if(!d){ bar.innerHTML=''; return; }
  let detail = '';
  if(diagOpen){
    detail = '<div class="diag-detail"><div class="dd-meta">基于 '+d.baseYear+' 年ESG报告</div>'+
      d.topics.map(t=>
        '<div class="dd-row">'+
          '<span class="dd-name">'+esc(t.name)+'</span>'+
          '<span class="dg-badge dg-'+t.status+'">'+(t.status==='full'?'完整披露':'缺口 '+t.gaps)+'</span>'+
          (t.gapNames.length? '<span class="dd-gaps">'+t.gapNames.map(g=>'<span class="dp-gap">'+esc(g)+'</span>').join('')+
            '</span>'
           : '<span class="dd-ok">无，当前议题已完整披露</span>')+
        '</div>').join('')+
      '</div>';
  }
  bar.innerHTML =
    '<div class="diagbar">'+
    '<span class="dg-tag">初步诊断</span>'+
    '<span class="dg-sum">识别 '+d.total+' 个关键议题：完整披露 '+d.fullCount+' 个 · <b class="dg-warn">存在缺口 '+(d.total-d.fullCount)+' 个</b></span>'+
    '<span class="dg-act">'+
      '<button class="tool-btn'+(gapsOnly?' dg-on':'')+'" id="btnGaps" onclick="toggleGaps()">'+(gapsOnly?'✕ 取消只看缺口':'◎ 仅看诊断缺口')+'</button>'+
      '<a class="dg-link" href="diagnosis.html" target="_blank">查看诊断报告 ↗</a>'+
      '<button class="dg-fold" onclick="toggleDiagDetail()">'+(diagOpen?'收起 ▴':'展开 ▾')+'</button>'+
    '</span></div>'+detail;
}
window.toggleGaps = function(){ gapsOnly=!gapsOnly; renderDiagBar(); renderBody(); };
window.toggleDiagDetail = function(){ diagOpen=!diagOpen; renderDiagBar(); };

/* ---------------- 页签 ---------------- */
function renderTabs(){
  const sel = selectedStds();
  const tabs = document.getElementById('stdTabs');
  tabs.innerHTML = '';
  sel.forEach(k=>{
    const b = document.createElement('button');
    b.className = 'std-tab' + (!inPreview && activeStd===k ? ' active' : '');
    b.innerHTML = shortName(k) + ' <span class="cnt">' + countItems(STANDARDS[k]) + ' 项指标</span>';
    b.onclick = ()=>{ activeStd=k; inPreview=false; activeTopic=null; renderBody(); scrollToFill(); };
    tabs.appendChild(b);
  });
  const pv = document.createElement('button');
  pv.className = 'std-tab preview-tab' + (inPreview ? ' active' : '');
  pv.textContent = '汇总预览';
  pv.onclick = ()=>{ inPreview=true; renderBody(); scrollToFill(); };
  tabs.appendChild(pv);
}
function scrollToFill(){
  const el = document.getElementById('fill');
  if(el) el.scrollIntoView({ behavior:'smooth', block:'start' });
}

/* ---------------- 议题导航 ---------------- */
function renderTopicPills(topics){
  if(inPreview || viewMode!=='topic') return;
  const std = STANDARDS[activeStd];
  if(!std) return;
  if(!topics) topics = (gapsOnly && DIAGNOSIS) ? std.topics.filter(t=>diagGapOfTopicName(t.name)) : std.topics;
  const row = document.getElementById('topicRow');
  const cur = activeTopic;
  row.innerHTML = '';
  topics.forEach(t=>{
    const p = document.createElement('span');
    p.className = 'pill' + (t.id===cur ? ' active' : '');
    const dg = diagOfTopicName(t.name);
    p.innerHTML = esc(t.name) + (dg&&dg.gaps>0?'<span class="dg-badge dg-'+dg.status+'" title="初步诊断：'+DG_STATUS[dg.status]+' · 缺口 '+dg.gaps+' 项">'+dg.gaps+'</span>':'') + '<span class="dot '+topicDot(t, activeStd)+'"></span>';
    p.onclick = ()=>{ activeTopic=t.id; renderBody(); };
    row.appendChild(p);
  });
}

/* ---------------- 填报主体 ---------------- */
function renderBody(){
  const desc = document.getElementById('stdDesc');
  const row = document.getElementById('topicRow');
  const list = document.getElementById('itemList');
  const slot = document.getElementById('pgSlot');
  const sel = selectedStds();

  if(sel.length===0){
    desc.textContent = ''; row.innerHTML = ''; slot.innerHTML = '';
    list.innerHTML = '<div class="empty-hint">请先在上方「披露标准」中勾选至少一项——页签将随勾选自动生成</div>';
    return;
  }
  if(inPreview){ renderPreview(sel); return; }
  if(!sel.includes(activeStd)) activeStd = sel[0];

  const std = STANDARDS[activeStd];

  desc.innerHTML = esc(std.name) + ' · ' + esc(std.basis) +
    '<span class="code-lg">编号前缀：M 沪深北指引 · H 港交所 · F 财政部 · I ISSB</span>' +
    '<span class="seg">'+
    '<button data-v="topic" class="'+(viewMode==='topic'?'on':'')+'">按议题区块</button>'+
    '<button data-v="num" class="'+(viewMode==='num'?'on':'')+'">定量批量录入</button>'+
    '<button data-v="txt" class="'+(viewMode==='txt'?'on':'')+'">定性集中撰写</button>'+
    '<button data-v="mix" class="'+(viewMode==='mix'?'on':'')+'">定性/定量</button>'+
    '</span>';
  desc.querySelectorAll('.seg button').forEach(b=>b.onclick=()=>{ viewMode=b.dataset.v; renderBody(); });

  refreshProgress();

  renderDiagBar();

  /* ---- 视图一：按议题区块 ---- */
  if(viewMode==='topic'){
    const topics = (gapsOnly && DIAGNOSIS) ? std.topics.filter(t=>diagGapOfTopicName(t.name)) : std.topics;
    if(!topics.length){
      row.innerHTML=''; list.innerHTML='<div class="empty-hint">当前标准下没有初步诊断识别出缺口的议题</div>'; return;
    }
    if(!activeTopic || !topics.find(t=>t.id===activeTopic)) activeTopic = topics[0].id;
    renderTopicPills(topics);
    const topic = std.topics.find(t=>t.id===activeTopic);
    list.innerHTML = '';
    const dg = diagGapOfTopicName(topic.name);
    if(dg){
      const dp = document.createElement('div');
      dp.className = 'diag-panel';
      dp.innerHTML =
        '<div class="dp-head"><span class="dp-badge dg-'+dg.status+'">'+DG_STATUS[dg.status]+'</span>初步诊断 · '+esc(dg.name)+'<span class="dp-base">基于 '+DIAGNOSIS.baseYear+' 年报</span></div>'+
        '<div class="dp-found"><span class="k">识别的结果</span>'+esc(dg.found)+'</div>'+
        '<div class="dp-gaps"><span class="k">需优先补齐</span>'+
          dg.gapNames.map(g=>'<span class="dp-gap">'+esc(g)+'</span>').join('')+
        '</div>';
      list.appendChild(dp);
    }
    let lastG = '';
    topic.items.forEach(it=>{
      if(it.g && it.g!==lastG){
        lastG = it.g;
        const h = document.createElement('div');
        h.className = 'blk-title';
        h.textContent = it.g;
        list.appendChild(h);
      }
      const [tagCls, tagTxt] = typeInfo(it.type);
      const [stCls, stTxt] = statusOf(activeStd, it.code);
      const div = document.createElement('div');
      div.className = 'item';
      div.innerHTML =
        '<div class="item-head"><span class="code">'+esc(it.code)+'</span>'+cardTitle(it)+
          '<span class="tag '+tagCls+'">'+tagTxt+'</span>'+
          '<span class="st '+stCls+'" data-st="'+activeStd+':'+it.code+'" title="点击标记为待复核" onclick="toggleFlag(\''+activeStd+"','"+it.code+'\')" style="cursor:pointer">'+stTxt+'</span>'+
          useTagsHtml(activeStd, it.code)+'</div>'+
        '<div class="req-line"><span class="k">披露要求</span>'+esc(it.req)+'</div>'+
        inputFor(activeStd, it)+
        (it.type!=='text' ? yoyHtml(activeStd, it) : '')+
        metaHtml(it);
      list.appendChild(div);
    });
    return;
  }

  /* ---- 视图二：定量批量录入 ---- */
  row.innerHTML = '';
  if(viewMode==='num'){
    let html = '';
    std.topics.forEach((t, ti)=>{
      if(gapsOnly && !diagGapOfTopicName(t.name)) return;
      const nums = t.items.filter(i=>i.type==='num');
      if(!nums.length) return;
      const dg = diagGapOfTopicName(t.name);
      const ck = viewMode+'|'+activeStd+'#'+ti;
      const off = collapsedTopics.has(ck);
      html += '<table class="pv batch"><tr class="blk'+(off?' off':'')+'" onclick="toggleBlkRow(this,\''+ck+'\')"><td colspan="5"><span class="blk-arrow">▾</span>'+esc(t.name)+(dg?'<span class="dg-badge dg-'+dg.status+'">诊断缺口 '+dg.gaps+'</span>':'')+'<span class="blk-cnt">'+nums.length+' 项</span></td></tr>';
      nums.forEach(it=>{
        const v = getVal(activeStd, it.code);
        const uses = RATING_MAP[activeStd+':'+it.code] || [];
        html += '<tr'+(off?' style="display:none"':'')+'><td class="c-code">'+esc(it.code)+'</td>'+
          '<td>'+(it.name?'<b>'+esc(it.name)+'</b>　':'')+esc(it.req)+'</td>'+
          '<td class="c-unit">'+esc(it.unit||'')+'</td>'+
          '<td><input class="input" data-in="'+activeStd+':'+it.code+'" placeholder="汇总数值" value="'+esc(v.v||'')+'" oninput="onVal(\''+activeStd+"','"+it.code+'\',\'v\',this)"></td>'+
          '<td class="c-use">'+(uses.length?uses.join(' · '):'—')+'</td></tr>';
      });
      html += '</table>';
    });
    list.innerHTML = html || '<div class="empty-hint">该标准下没有纯定量指标</div>';
    return;
  }

  /* ---- 视图三/四：定性 / 定性定量 ---- */
  const want = viewMode==='mix' ? 'mix' : 'text';
  let html = '';
  std.topics.forEach((t, ti)=>{
    if(gapsOnly && !diagGapOfTopicName(t.name)) return;
    const txts = t.items.filter(i=>i.type===want);
    if(!txts.length) return;
    const dg = diagGapOfTopicName(t.name);
    const ck = viewMode+'|'+activeStd+'#'+ti;
    const off = collapsedTopics.has(ck);
    html += '<div class="topic-sec'+(off?' collapsed':'')+'">'+
      '<div class="blk-title tg-hd" onclick="toggleTopicSec(this,\''+ck+'\')"><span class="tg-arrow">▾</span>'+esc(t.name)+(dg?'<span class="dg-badge dg-'+dg.status+'">诊断缺口 '+dg.gaps+'</span>':'')+'<span class="blk-cnt">'+txts.length+' 项</span></div>'+
      '<div class="tg-body">';
    txts.forEach(it=>{
      const [tc, tt] = typeInfo(it.type);
      const [stCls, stTxt] = statusOf(activeStd, it.code);
      html += '<div class="item">'+
        '<div class="item-head"><span class="code">'+esc(it.code)+'</span>'+cardTitle(it)+
          '<span class="tag '+tc+'">'+tt+'</span>'+
          '<span class="st '+stCls+'" data-st="'+activeStd+':'+it.code+'" title="点击标记为待复核" onclick="toggleFlag(\''+activeStd+"','"+it.code+'\')" style="cursor:pointer">'+stTxt+'</span>'+
          useTagsHtml(activeStd, it.code)+'</div>'+
        '<div class="req-line"><span class="k">披露要求</span>'+esc(it.req)+'</div>'+
        inputFor(activeStd, it)+
        (it.type!=='text' ? yoyHtml(activeStd, it) : '')+
        metaHtml(it)+'</div>';
    });
    html += '</div></div>';
  });
  list.innerHTML = html || '<div class="empty-hint">该标准下没有「'+(viewMode==='mix'?'定性/定量':'定性')+'」类指标</div>';
}

/* ---------------- 汇总预览 + 提交前校验 ---------------- */
function missingList(stdKey){
  const out = [];
  STANDARDS[stdKey].topics.forEach(t=>t.items.forEach(it=>{
    if(!isFilled(getVal(stdKey, it.code))) out.push({ code: it.code, name: it.name || String(it.req).slice(0,24) });
  }));
  return out;
}
function yoyAnomalies(){
  const prevY = String(parseInt(store.meta.year) - 1);
  const out = [];
  selectedStds().forEach(k=>STANDARDS[k].topics.forEach(t=>t.items.forEach(it=>{
    if(it.type==='text') return;
    const pv = parseFloat((getVal(k,it.code,prevY).v||'').replace(/,/g,''));
    const cn = parseFloat((getVal(k,it.code).v||'').replace(/,/g,''));
    if(!isNaN(pv) && !isNaN(cn) && pv!==0){
      const d = (cn-pv)/pv*100;
      if(Math.abs(d)>30) out.push({ std:k, code:it.code, name:it.name||'', d:d.toFixed(1) });
    }
  })));
  return out;
}
window.jumpStd = function(k){
  if(!store.stdSel.includes(k)) return;
  activeStd = k; inPreview = false; viewMode = 'topic'; activeTopic = null;
  render(); scrollToFill();
};

function renderPreview(sel){
  document.getElementById('pgSlot').innerHTML = '';
  const desc = document.getElementById('stdDesc');
  const row = document.getElementById('topicRow');
  const list = document.getElementById('itemList');
  desc.textContent = '汇总预览 · 按所选标准统计指标数量与填报完成度（数据按报告年度 + 统计范围归档）';
  row.innerHTML = '';

  let trs = '';
  sel.forEach(k=>{
    const s = STANDARDS[k];
    trs += '<tr><td>'+shortName(k)+'</td><td>'+s.topics.length+'</td><td>'+countItems(s)+'</td><td>'+
      countType(s,'num')+'</td><td>'+countType(s,'text')+'</td><td>'+countType(s,'mix')+'</td><td><b>'+
      countFilled(k)+' / '+countItems(s)+'</b></td></tr>';
  });
  let html = '<table class="pv"><tr><th>披露标准</th><th>议题数</th><th>指标数</th><th>定量</th><th>定性</th><th>定性/定量</th><th>已填报</th></tr>'+trs+'</table>';



  /* 评级准备度（参考映射，可在 data.js 维护） */
  const ratings = selectedRatings();
  if(ratings.length){
    let rtrs = '';
    ratings.forEach(r=>{
      const g = RATING_GAP[r] || { cover:'—', gap:'—' };
      rtrs += '<tr><td><b>'+esc(r)+'</b></td><td>'+esc(g.cover)+'</td><td style="color:#8a8f99">'+esc(g.gap)+'</td></tr>';
    });
    html += '<h3 class="pv-h">评级准备度 <span class="pv-sub">只读校验 · 不产生额外填报任务</span></h3>'+
      '<table class="pv"><tr><th style="width:130px">评级标准</th><th>可复用的已填数据</th><th>缺口与处理方式</th></tr>'+rtrs+'</table>';
  }
  html += '<div class="note" style="margin-top:12px">评级标准不作为填报入口：同源指标自动复用；个别缺口集中在选填的「评级补充信息」池；排放密度、流失率等比率类指标可按已填数据自动计算。</div>';
  list.innerHTML = html;
}

function render(){ renderTabs(); renderBody(); }

/* ---------------- 基本信息绑定 ---------------- */
const META_FIELDS = ['org','year','scope','company','gics','stockName','stockCode','biz'];
function bindMeta(){
  // 年度选项：近 5 年
  const ySel = document.getElementById('f_year');
  const cy = new Date().getFullYear();
  ySel.innerHTML = '';
  for(let y=cy+1; y>=cy-4; y--){
    const o = document.createElement('option');
    o.value = String(y); o.textContent = y + ' 年度';
    ySel.appendChild(o);
  }
  META_FIELDS.forEach(f=>{
    const el = document.getElementById('f_'+f);
    if(!el) return;
    el.value = store.meta[f] || (f==='year' ? String(cy) : '');
    el.addEventListener(f==='year'||f==='org'||f==='gics' ? 'change' : 'input', ()=>{
      store.meta[f] = el.value;
      save();
      if(f==='year'){ activeTopic = null; render(); }
    });
  });
  ['listed','ex','size','mkt','db'].forEach(name=>{
    document.querySelectorAll('input[name="'+name+'"]').forEach(r=>{
      r.checked = (store.meta[name] === r.value);
      r.addEventListener('change', ()=>{ store.meta[name] = r.value; save(); });
    });
  });
}

/* ---------------- 办公地点 ---------------- */
function renderOffices(){
  const tb = document.getElementById('officeBody');
  tb.innerHTML = '';
  store.offices.forEach((o, i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td><input class="input" value="'+esc(o.place)+'" oninput="onOffice('+i+',\'place\',this.value)"></td>'+
      '<td><input class="input" value="'+esc(o.area)+'" oninput="onOffice('+i+',\'area\',this.value)"></td>'+
      '<td><input class="input" value="'+esc(o.people)+'" oninput="onOffice('+i+',\'people\',this.value)"></td>'+
      '<td><input class="input" value="'+esc(o.note||'')+'" placeholder="备注" oninput="onOffice('+i+',\'note\',this.value)"></td>'+
      '<td><button class="tool-btn" onclick="delOffice('+i+')">删除</button></td>';
    tb.appendChild(tr);
  });
}
window.onOffice = function(i, field, val){ store.offices[i][field] = val; save(); };
window.delOffice = function(i){ store.offices.splice(i,1); save(); renderOffices(); };
document.getElementById('btnAddOffice').addEventListener('click', ()=>{
  store.offices.push({ place:'', area:'', people:'', note:'' });
  save(); renderOffices();
  document.getElementById('officeBox').open = true;
});

/* ---------------- 披露标准 / 评级勾选 ---------------- */
/* 标准选择采用「保存门闸」：改动勾选只标记为待保存，
   点击「保存选择」后才写入 store 并重生成填报区 */
function pendingStds(){
  return STD_ORDER.filter(k=>{
    const cb = document.querySelector('#stdChecks input[value="'+k+'"]');
    return cb && cb.checked;
  });
}
function renderStdGate(){
  const gate = document.getElementById('stdGate');
  const zone = document.querySelector('.tabzone');
  if(!gate || !zone) return;
  const pend = pendingStds();
  const saved = STD_ORDER.filter(k=>store.stdSel.includes(k));
  const dirty = pend.join(',') !== saved.join(',');
  const locked = dirty || saved.length===0;
  gate.style.display = locked ? 'flex' : 'none';
  gate.querySelector('.sg-txt').textContent = saved.length===0
    ? '尚未保存披露标准：勾选后点击「保存选择」，填报区才会生成指标页签'
    : '披露标准已修改：点击「保存选择」后，填报区将按新标准重新生成';
  zone.classList.toggle('locked', locked);
}
window.saveStdSel = function(){
  const pend = pendingStds();
  if(!pend.length){ alert('请至少勾选一项披露标准'); return; }
  store.stdSel = pend;
  save();
  if(!pend.includes(activeStd)) activeStd = pend[0];
  activeTopic = null;
  renderStdGate();
  render();
  scrollToFill();
};
function bindChecks(){
  document.querySelectorAll('#stdChecks input').forEach(cb=>{
    cb.checked = store.stdSel.includes(cb.value);
    cb.closest('.std-check').classList.toggle('on', cb.checked);
    cb.addEventListener('change', ()=>{
      cb.closest('.std-check').classList.toggle('on', cb.checked);
      renderStdGate();   // 只提示保存，不立即改 store / 不重渲染
    });
  });
  document.querySelectorAll('#optRatings input').forEach(cb=>{
    cb.checked = store.ratingSel.includes(cb.value);
    cb.addEventListener('change', ()=>{
      if(cb.checked){ if(!store.ratingSel.includes(cb.value)) store.ratingSel.push(cb.value); }
      else{ store.ratingSel = store.ratingSel.filter(r=>r!==cb.value); }
      save();
      renderBody();
    });
  });
}

/* ---------------- Excel 导出 / 导入 ---------------- */
const XLSX_HEADERS = ['标准','编号','维度/议题','一级指标','二级指标','指标名称','性质','单位','披露要求','定量值','定性内容'];

window.exportExcel = function(){
  if(typeof XLSX === 'undefined'){ alert('Excel 组件未加载：请确认 vendor/xlsx.full.min.js 存在'); return; }
  const sel = selectedStds();
  if(!sel.length){ alert('请先勾选至少一项披露标准'); return; }
  const m = store.meta;
  const wb = XLSX.utils.book_new();
  const info = [['字段','值'],['公司全称',m.company||''],['报告年度',m.year||''],['统计范围',m.scope||''],
    ['所属组织',m.org||''],['GICS行业',m.gics||''],['股票简称',m.stockName||''],['股票代码',m.stockCode||''],['主营业务',m.biz||'']];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(info), '基本信息');
  sel.forEach(k=>{
    const rows = [XLSX_HEADERS];
    STANDARDS[k].topics.forEach(t=>t.items.forEach(it=>{
      const v = getVal(k, it.code);
      rows.push([shortName(k), it.code, t.name, it.g||'', it.lv2||'', it.name||'',
        typeInfo(it.type)[1], it.unit||'', it.req||'', v.v||'', v.t||'']);
    }));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:14},{wch:8},{wch:18},{wch:14},{wch:14},{wch:26},{wch:10},{wch:12},{wch:50},{wch:14},{wch:40}];
    XLSX.utils.book_append_sheet(wb, ws, shortName(k).replace(/[\\\/\?\*\[\]]/g,'').slice(0,28));
  });
  XLSX.writeFile(wb, 'ESG填报_' + (m.company||'未命名') + '_' + (m.year||'') + '.xlsx');
};

window.importExcel = function(input){
  const f = input.files[0];
  if(!f) return;
  if(typeof XLSX === 'undefined'){ alert('Excel 组件未加载'); input.value=''; return; }
  const rd = new FileReader();
  rd.onload = e=>{
    try{
      const wb = XLSX.read(e.target.result, { type:'array' });
      let n = 0;
      wb.SheetNames.forEach(sn=>{
        if(sn==='基本信息') return;
        XLSX.utils.sheet_to_json(wb.Sheets[sn]).forEach(r=>{
          const code = String(r['编号']||'').trim();
          const std = stdByName(String(r['标准']||'').trim()) || stdByName(code);
          if(!std || !code || !findItem(std, code)) return;
          const qv = r['定量值'], qt = r['定性内容'];
          const k = vkey(std, code), yd = yearData();
          if(qv!==undefined && String(qv).trim()!==''){ if(!yd.values[k]) yd.values[k]={}; yd.values[k].v = String(qv).trim(); n++; }
          if(qt!==undefined && String(qt).trim()!==''){ if(!yd.values[k]) yd.values[k]={}; yd.values[k].t = String(qt).trim(); n++; }
        });
      });
      save();
      render();
      alert('导入完成：写入 ' + n + ' 个数据点（归属 ' + (store.meta.year||'') + ' 年度）');
    }catch(err){ alert('导入失败：' + err.message); }
    input.value = '';
  };
  rd.readAsArrayBuffer(f);
};

document.getElementById('btnExport').addEventListener('click', exportExcel);
document.getElementById('btnImport').addEventListener('click', ()=>document.getElementById('fileInput').click());
document.getElementById('fileInput').addEventListener('change', function(){ importExcel(this); });

/* ---------------- 初始化 ---------------- */
bindMeta();
renderOffices();
bindChecks();
activeStd = STD_ORDER.find(k=>store.stdSel.includes(k)) || null;
renderStdGate();
render();
