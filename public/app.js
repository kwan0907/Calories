const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const API=(window.CRAB_API_BASE||"").replace(/\/+$/,"");
const S={user:null,settings:{business_name:"蟹帳 POS",currency:"HKD"},products:[]};

document.addEventListener("DOMContentLoaded",boot);
window.addEventListener("hashchange",()=>S.user&&route());

async function req(path,opt={}){
  const init={method:opt.method||"GET",headers:{},credentials:"include"};
  if(opt.body!==undefined){init.headers["content-type"]="application/json";init.body=JSON.stringify(opt.body)}
  const r=await fetch(API+path,init),ct=r.headers.get("content-type")||"",d=ct.includes("json")?await r.json():await r.text();
  if(!r.ok){if(r.status===401&&!opt.noRedirect){S.user=null;login()}throw Error(d?.message||d?.error||("HTTP "+r.status))}
  return d;
}
async function boot(){
  try{const x=await req("/api/setup/status",{noRedirect:true});if(x.needs_setup)return setup();
    const me=await req("/api/auth/me",{noRedirect:true});S.user=me.user;S.settings=me.settings||S.settings;shell();route();
  }catch{login()}
}
function setup(){
  $("#app").innerHTML=auth("首次設定","建立蟹帳 POS 第一個管理員",`
  <form id="f">
    ${field("Setup Key","setup_key","password")}
    ${field("管理員名稱","name")}
    ${field("Email","email","email")}
    ${field("密碼","password","password")}
    <button class="btn primary">建立管理員</button>
  </form><p class="help">Setup Key 是 Cloudflare 的 SETUP_KEY secret。管理員建立後不會再出現此頁。</p>`);
  $("#f").onsubmit=async e=>{e.preventDefault();try{const x=await req("/api/setup",{method:"POST",body:obj(e),noRedirect:true});S.user=x.user;S.settings=(await req("/api/auth/me")).settings;shell();location.hash="#/dashboard";route();toast("設定完成","success")}catch(er){toast(er.message,"error")}}
}
function login(){
  $("#app").innerHTML=auth("蟹帳 POS","訂單・利潤・送貨・投資者",`
  <form id="f">${field("Email","email","email")}${field("密碼","password","password")}<button class="btn primary">登入</button></form>`);
  $("#f").onsubmit=async e=>{e.preventDefault();try{const x=await req("/api/auth/login",{method:"POST",body:obj(e),noRedirect:true});S.user=x.user;S.settings=(await req("/api/auth/me")).settings;shell();location.hash="#/dashboard";route()}catch(er){toast(er.message,"error")}}
}
function auth(t,sub,html){return `<div class="auth-shell"><div class="auth-card"><div class="brand-big"><div class="brand-mark">蟹</div><div><h1>${t}</h1><p>${sub}</p></div></div>${html}</div></div>`}
function shell(){
  const a=S.user.role==="admin",nav=[
    ["dashboard","⌂","總覽",1],["pos","＋","POS 開單",a],["orders","▤","訂單",1],["delivery","🚚","送貨",1],
    ["customers","人","客戶",a],["products","盒","產品",1],["expenses","$","支出",1],["investors","%","投資者",1],
    ["reports","▥","報表",1],["users","🔐","帳戶",a],["audit","↺","操作紀錄",a],["settings","⚙","設定",a]
  ].filter(x=>x[3]);
  $("#app").innerHTML=`<div class="app-shell"><aside class="sidebar"><div class="brand"><div class="brand-mark">蟹</div><div><div class="brand-title">${esc(S.settings.business_name||"蟹帳 POS")}</div><div class="brand-sub">獨立雲端 POS</div></div></div>
    <nav class="nav">${nav.map(x=>`<button data-r="${x[0]}"><span>${x[1]}</span>${x[2]}</button>`).join("")}</nav></aside>
    <main class="main"><header class="topbar"><div class="top-title">${esc(S.settings.business_name||"蟹帳 POS")}</div><div class="user-box"><span class="name">${esc(S.user.name)}</span><span class="role">${a?"管理員":"投資者"}</span><button id="logout" class="btn small ghost">登出</button></div></header><section id="content" class="content"></section></main></div>`;
  $$(".nav button").forEach(b=>b.onclick=()=>location.hash="#/"+b.dataset.r);
  $("#logout").onclick=async()=>{try{await req("/api/auth/logout",{method:"POST"})}catch{}S.user=null;login()}
}
function route(){
  const raw=(location.hash||"#/dashboard").replace(/^#\//,""),[r,q=""]=raw.split("?"),p=new URLSearchParams(q);
  $$(".nav button").forEach(b=>b.classList.toggle("active",b.dataset.r===r));
  const map={dashboard,orders,delivery,customers,products,expenses,investors,reports,users,audit,settings,pos:()=>pos(p.get("edit"))};
  (map[r]||dashboard)().catch(e=>{toast(e.message,"error");$("#content").innerHTML=`<div class="empty">${esc(e.message)}</div>`})
}
async function dashboard(){
  const d=await req("/api/dashboard?today="+today());
  $("#content").innerHTML=head("總覽","今日及本月生意狀況")+`
  <div class="grid cards">
    ${metric("今日營業額",money(d.today.revenue_cents),d.today.order_count+" 張訂單","gold")}
    ${metric("今日淨利",money(d.today.net_profit_cents),"支出 "+money(d.today.expense_cents),"green")}
    ${metric("本月營業額",money(d.month.revenue_cents),d.month.order_count+" 張訂單")}
    ${metric("本月淨利",money(d.month.net_profit_cents),"支出 "+money(d.month.expense_cents),"green")}
    ${metric("今日未收",money(d.today.unpaid_cents),"應收未收","red")}
    ${metric("本月未收",money(d.month.unpaid_cents),"應收未收","red")}
    ${d.investor?metric("我的估算應佔 "+num(d.investor.percentage)+"%",money(d.investor.estimated_share_cents),d.investor.name,"gold"):""}
  </div><div class="grid two" style="margin-top:14px">
    <div class="card"><h3>本月熱賣</h3>${table(["產品","數量","銷售"],(d.top_products||[]).map(x=>[esc(x.name),num(x.qty),money(x.sales_cents)]))}</div>
    <div class="card"><h3>即將送貨</h3>${table(["日期","訂單","狀態"],(d.deliveries||[]).map(x=>[esc(x.delivery_date||"-"),esc(x.order_no),badge(x.delivery_status)]))}</div>
  </div>`
}
async function getProducts(all=false){const x=await req("/api/products"+(all?"?all=1":""));S.products=x.products||[];return S.products}
async function pos(id){
  if(S.user.role!=="admin")return location.hash="#/dashboard";
  const ps=await getProducts(),data=id?await req("/api/orders/"+encodeURIComponent(id)):null,o=data?.order||{},its=data?.items||[];
  if(!ps.length){$("#content").innerHTML=head("POS 開單","請先新增產品")+"<div class=empty>沒有產品</div>";return}
  const lines=its.length?its.map(x=>({product_id:x.product_id,qty:+x.qty,unit_price_cents:+x.unit_price_cents})):[{product_id:ps[0].id,qty:1,unit_price_cents:+ps[0].sale_price_cents||0}];
  $("#content").innerHTML=head(id?"修改訂單":"POS 開單",id?esc(o.order_no):"快速開單")+`
  <form id="orderForm"><div class="card"><div class="form-grid">
    <div>${inp("訂單編號","order_no",o.order_no||"","可留空自動產生")}</div><div>${inp("訂單日期","order_date",o.order_date||today(),"","date")}</div>
    <div>${sel("狀態","status",[["confirmed","已確認"],["completed","已完成"],["draft","草稿"],["cancelled","取消"]],o.status||"confirmed")}</div>
    <div>${sel("付款方式","payment_method",[["","未指定"],["FPS","FPS"],["PayMe","PayMe"],["現金","現金"],["銀行轉帳","銀行轉帳"],["其他","其他"]],o.payment_method||"")}</div>
    <div>${inp("客戶姓名","customer_name",o.customer_name||"")}</div><div>${inp("電話","customer_phone",o.customer_phone||"")}</div>
    <div class="span2">${inp("地址","customer_address",o.customer_address||"")}</div>
    <div>${inp("送貨日期","delivery_date",o.delivery_date||"","","date")}</div><div>${inp("送貨時段","delivery_slot",o.delivery_slot||"")}</div>
    <div>${inp("配送員","delivery_person",o.delivery_person||"")}</div><div>${sel("送貨狀態","delivery_status",[["待安排","待安排"],["已安排","已安排"],["配送中","配送中"],["已完成","已完成"],["取消","取消"]],o.delivery_status||"待安排")}</div>
  </div><div class="section-title"><h3>產品</h3><button type="button" id="addLine" class="btn small">＋ 加產品</button></div><div id="lines" class="line-items"></div>
  <div class="section-title"><h3>金額</h3></div><div class="form-grid">
    <div>${moneyInp("折扣","discount",o.discount_cents)}</div><div>${moneyInp("客戶送貨費","delivery_fee",o.delivery_fee_cents)}</div>
    <div>${moneyInp("其他收費","other_fee",o.other_fee_cents)}</div><div>${moneyInp("實收","paid_amount",o.paid_amount_cents)}</div>
    <div>${moneyInp("實際送貨成本","delivery_cost",o.delivery_cost_cents)}</div><div>${moneyInp("其他成本","other_cost",o.other_cost_cents)}</div>
    <div class="span2"><label>備註</label><textarea name="notes">${esc(o.notes||"")}</textarea></div>
  </div><div id="totals" class="totals" style="margin-top:16px"></div>
  <div class="actions" style="justify-content:flex-end;margin-top:16px"><button type="button" id="back" class="btn">返回</button><button class="btn primary">${id?"儲存修改":"完成開單"}</button></div></div></form>`;
  const box=$("#lines");
  const draw=()=>{box.innerHTML=lines.map((x,i)=>{const p=ps.find(z=>z.id===x.product_id)||ps[0];return `<div class="line-row" data-i="${i}">
    <div><label>產品</label><select class="lp">${ps.map(z=>`<option value="${z.id}" ${z.id===x.product_id?"selected":""}>${esc(z.category)}｜${esc(z.name)}</option>`).join("")}</select></div>
    <div><label>數量</label><input class="lq" type="number" min=".01" step=".01" value="${x.qty}"></div>
    <div class="price-col"><label>單價</label><input class="lv" type="number" min="0" step=".01" value="${(x.unit_price_cents/100).toFixed(2)}"></div>
    <div class="cost-col"><label>成本</label><input disabled value="${((+p.cost_cents||0)/100).toFixed(2)}"></div><button type="button" class="btn small danger remove">×</button></div>`}).join("");
    $$(".line-row",box).forEach(r=>{const i=+r.dataset.i;$(".lp",r).onchange=e=>{const p=ps.find(z=>z.id===e.target.value);lines[i].product_id=p.id;lines[i].unit_price_cents=+p.sale_price_cents||0;draw();calc()};$(".lq",r).oninput=e=>{lines[i].qty=+e.target.value||0;calc()};$(".lv",r).oninput=e=>{lines[i].unit_price_cents=cents(e.target.value);calc()};$(".remove",r).onclick=()=>{if(lines.length>1){lines.splice(i,1);draw();calc()}}})
  };
  const calc=()=>{const sub=lines.reduce((a,x)=>a+Math.round(x.qty*x.unit_price_cents),0),cost=lines.reduce((a,x)=>a+Math.round(x.qty*(+ps.find(z=>z.id===x.product_id)?.cost_cents||0)),0),disc=cents($('[name="discount"]').value),df=cents($('[name="delivery_fee"]').value),of=cents($('[name="other_fee"]').value),dc=cents($('[name="delivery_cost"]').value),oc=cents($('[name="other_cost"]').value),total=Math.max(0,sub-disc+df+of),net=total-cost-dc-oc;$("#totals").innerHTML=`<div class="total-row"><span>商品小計</span><b>${money(sub)}</b></div><div class="total-row"><span>商品成本</span><b>${money(cost)}</b></div><div class="total-row grand"><span>應收總額</span><b>${money(total)}</b></div><div class="total-row profit"><span>此單淨利</span><b>${money(net)}</b></div>`};
  draw();calc();$("#addLine").onclick=()=>{lines.push({product_id:ps[0].id,qty:1,unit_price_cents:+ps[0].sale_price_cents||0});draw();calc()};$$('input[name="discount"],input[name="delivery_fee"],input[name="other_fee"],input[name="delivery_cost"],input[name="other_cost"]').forEach(x=>x.oninput=calc);$("#back").onclick=()=>location.hash="#/orders";
  $("#orderForm").onsubmit=async e=>{e.preventDefault();const f=obj(e),payload={order_no:f.order_no,order_date:f.order_date,status:f.status,payment_method:f.payment_method,delivery_date:f.delivery_date,delivery_slot:f.delivery_slot,delivery_person:f.delivery_person,delivery_status:f.delivery_status,customer:{name:f.customer_name||"散客",phone:f.customer_phone,address:f.customer_address,notes:""},items:lines,discount_cents:cents(f.discount),delivery_fee_cents:cents(f.delivery_fee),other_fee_cents:cents(f.other_fee),paid_amount_cents:cents(f.paid_amount),delivery_cost_cents:cents(f.delivery_cost),other_cost_cents:cents(f.other_cost),notes:f.notes};try{const x=await req(id?"/api/orders/"+id:"/api/orders",{method:id?"PATCH":"POST",body:payload});toast("已儲存 "+x.order_no,"success");location.hash="#/orders"}catch(er){toast(er.message,"error")}}
}
async function orders(){
  const a=S.user.role==="admin";$("#content").innerHTML=head("訂單","搜尋、收款、利潤及送貨",a?'<button id="newO" class="btn primary">＋ 新訂單</button>':"")+`
  <div class="filters"><input id="q" placeholder="${a?"訂單 / 客戶 / 電話":"訂單編號"}"><input id="from" type="date"><input id="to" type="date"><select id="pay"><option value="">全部付款</option><option value="unpaid">未付款</option><option value="partial">部分付款</option><option value="paid">已付款</option></select><button id="go" class="btn">搜尋</button>${a?'<button id="csv" class="btn">CSV</button>':""}</div><div id="box" class="card"></div>`;
  if(a)$("#newO").onclick=()=>location.hash="#/pos";
  const load=async()=>{const p=new URLSearchParams();["q","from","to"].forEach(k=>{$("#"+k).value&&p.set(k,$("#"+k).value)});$("#pay").value&&p.set("payment",$("#pay").value);const x=await req("/api/orders?"+p);$("#box").innerHTML=table(["訂單","客戶","內容","總額","付款","淨利","送貨",""],(x.orders||[]).map(o=>[`<b>${esc(o.order_no)}</b><div class=muted>${esc(o.order_date)}</div>`,a?`${esc(o.customer_name||"散客")}<div class=muted>${esc(o.customer_phone||"")}</div>`:"已隱藏客戶資料",esc(o.item_summary||""),money(o.total_cents),payBadge(o.payment_status),`<span class="${+o.net_profit_cents>=0?"positive":"negative"}">${money(o.net_profit_cents)}</span>`,`${badge(o.delivery_status)}<div class=muted>${esc(o.delivery_date||"")}</div>`,a?`<button class="btn small edit" data-id="${o.id}">修改</button>`:""]));$$(".edit").forEach(b=>b.onclick=()=>location.hash="#/pos?edit="+encodeURIComponent(b.dataset.id))};
  $("#go").onclick=load;$("#q").onkeydown=e=>e.key==="Enter"&&load();
  if(a)$("#csv").onclick=async()=>{try{const r=await fetch(API+"/api/export/orders.csv",{credentials:"include"});if(!r.ok)throw Error("匯出失敗");const b=await r.blob(),u=URL.createObjectURL(b),a=document.createElement("a");a.href=u;a.download="crab-pos-orders.csv";a.click();URL.revokeObjectURL(u)}catch(e){toast(e.message,"error")}};
  await load()
}
async function delivery(){
  const x=await req("/api/orders"),rows=(x.orders||[]).filter(o=>o.delivery_date&&o.status!=="cancelled").sort((a,b)=>String(a.delivery_date).localeCompare(String(b.delivery_date)));
  $("#content").innerHTML=head("送貨","由訂單內管理日期、時段、配送員及狀態")+`<div class="card">${table(["日期","訂單","內容","配送","狀態",""],rows.map(o=>[`${esc(o.delivery_date)}<div class=muted>${esc(o.delivery_slot||"")}</div>`,esc(o.order_no),esc(o.item_summary||""),esc(o.delivery_person||"-"),badge(o.delivery_status),S.user.role==="admin"?`<button class="btn small de" data-id="${o.id}">修改訂單</button>`:""]))}</div>`;$$(".de").forEach(b=>b.onclick=()=>location.hash="#/pos?edit="+b.dataset.id)
}
async function customers(){
  if(S.user.role!=="admin")return location.hash="#/dashboard";$("#content").innerHTML=head("客戶","投資者不會取得此頁資料",'<button id="add" class="btn primary">＋ 客戶</button>')+'<div class="filters"><input id="cq" placeholder="姓名 / 電話"><button id="find" class="btn">搜尋</button></div><div id="box" class="card"></div>';
  const load=async()=>{const x=await req("/api/customers?q="+encodeURIComponent($("#cq").value||""));$("#box").innerHTML=table(["客戶","電話","地址","訂單","累計消費",""],(x.customers||[]).map(c=>[esc(c.name),esc(c.phone),esc(c.address),c.order_count,money(c.lifetime_value_cents),`<button class="btn small ce" data-id="${c.id}">修改</button>`]));$$(".ce").forEach(b=>b.onclick=()=>customerModal(x.customers.find(c=>c.id===b.dataset.id),load))};$("#add").onclick=()=>customerModal(null,load);$("#find").onclick=load;await load()
}
function customerModal(c,after){modal(c?"修改客戶":"新增客戶",`<form id="mf">${field("姓名","name","text",c?.name||"")}${field("電話","phone","text",c?.phone||"")}${field("地址","address","text",c?.address||"")}<div class=field><label>備註</label><textarea name=notes>${esc(c?.notes||"")}</textarea></div><button class="btn primary">儲存</button></form>`);$("#mf").onsubmit=async e=>{e.preventDefault();try{await req(c?"/api/customers/"+c.id:"/api/customers",{method:c?"PATCH":"POST",body:obj(e)});closeModal();after();toast("已儲存","success")}catch(er){toast(er.message,"error")}}}
async function products(){
  const a=S.user.role==="admin",ps=await getProducts(a);$("#content").innerHTML=head("產品","售價、成本、分類及庫存",a?'<button id="add" class="btn primary">＋ 產品</button>':"")+`<div class=card>${table(["產品","分類","售價","成本","毛利","庫存","狀態",""],ps.map(p=>[`<b>${esc(p.name)}</b><div class=muted>${esc(p.sku||"")}</div>`,esc(p.category),money(p.sale_price_cents),money(p.cost_cents),money((+p.sale_price_cents||0)-(+p.cost_cents||0)),p.track_stock?num(p.stock_qty)+" "+esc(p.unit):"不追蹤",p.is_active?"上架":"停用",a?`<button class="btn small pe" data-id="${p.id}">修改</button>`:""]))}</div>`;if(a){$("#add").onclick=()=>productModal(null,()=>products());$$(".pe").forEach(b=>b.onclick=()=>productModal(ps.find(p=>p.id===b.dataset.id),()=>products()))}}
function productModal(p,after){modal(p?"修改產品":"新增產品",`<form id=mf><div class=form-grid><div class=span2>${inp("產品名稱","name",p?.name||"")}</div><div>${inp("分類","category",p?.category||"其他")}</div><div>${inp("SKU","sku",p?.sku||"")}</div><div>${inp("單位","unit",p?.unit||"隻")}</div><div>${moneyInp("成本","cost",p?.cost_cents)}</div><div>${moneyInp("售價","price",p?.sale_price_cents)}</div><div>${inp("庫存","stock_qty",p?.stock_qty??0,"","number")}</div><div>${sel("追蹤庫存","track_stock",[["0","否"],["1","是"]],String(p?.track_stock||0))}</div><div>${sel("狀態","is_active",[["1","上架"],["0","停用"]],String(p?.is_active??1))}</div></div><button class="btn primary">儲存</button></form>`);$("#mf").onsubmit=async e=>{e.preventDefault();const f=obj(e),b={...f,cost_cents:cents(f.cost),sale_price_cents:cents(f.price),stock_qty:+f.stock_qty||0,track_stock:+f.track_stock,is_active:+f.is_active};try{await req(p?"/api/products/"+p.id:"/api/products",{method:p?"PATCH":"POST",body:b});closeModal();after();toast("產品已儲存","success")}catch(er){toast(er.message,"error")}}}
async function expenses(){
  const a=S.user.role==="admin",from=today().slice(0,7)+"-01",x=await req("/api/expenses?from="+from+"&to="+today());$("#content").innerHTML=head("支出","營運支出會從報表淨利扣除",a?'<button id="add" class="btn primary">＋ 支出</button>':"")+`<div class=card>${table(["日期","類型","說明","金額","備註"],(x.expenses||[]).map(e=>[esc(e.expense_date),esc(e.type),esc(e.description),money(e.amount_cents),esc(e.notes||"")]))}</div>`;if(a)$("#add").onclick=()=>expenseModal(()=>expenses())
}
function expenseModal(after){modal("新增支出",`<form id=mf>${field("日期","expense_date","date",today())}${field("類型","type","text","其他")}${field("說明","description")}${field("金額","amount","number")}<div class=field><label>備註</label><textarea name=notes></textarea></div><button class="btn primary">儲存</button></form>`);$("#mf").onsubmit=async e=>{e.preventDefault();const f=obj(e);f.amount_cents=cents(f.amount);try{await req("/api/expenses",{method:"POST",body:f});closeModal();after();toast("支出已新增","success")}catch(er){toast(er.message,"error")}}}
async function investors(){
  const a=S.user.role==="admin",x=await req("/api/investors");$("#content").innerHTML=head("投資者","投資比例及應佔利潤基礎",a?'<button id="add" class="btn primary">＋ 投資者</button>':"")+`<div class=card>${table(["名稱","比例","狀態","備註"],(x.investors||[]).map(i=>[esc(i.name),num(i.percentage)+"%",i.is_active?"啟用":"停用",esc(i.notes||"")]))}</div>`;if(a)$("#add").onclick=()=>investorModal(()=>investors())
}
function investorModal(after){modal("新增投資者",`<form id=mf>${field("名稱","name")}${field("比例 %","percentage","number","0")}<div class=field><label>備註</label><textarea name=notes></textarea></div><button class="btn primary">儲存</button></form>`);$("#mf").onsubmit=async e=>{e.preventDefault();const f=obj(e);f.percentage=+f.percentage||0;try{await req("/api/investors",{method:"POST",body:f});closeModal();after();toast("投資者已新增","success")}catch(er){toast(er.message,"error")}}}
async function reports(){
  const f=today().slice(0,7)+"-01",t=today();$("#content").innerHTML=head("報表","收入、成本、支出及淨利")+`<div class=filters><input id=rf type=date value="${f}"><input id=rt type=date value="${t}"><button id=rg class=btn>更新</button></div><div id=rb></div>`;
  const load=async()=>{const x=await req(`/api/reports/summary?from=${$("#rf").value}&to=${$("#rt").value}`),s=x.summary;$("#rb").innerHTML=`<div class="grid cards">${metric("營業額",money(s.revenue_cents),s.order_count+" 張訂單","gold")}${metric("商品成本",money(s.product_cost_cents))}${metric("營運支出",money(s.expense_cents))}${metric("淨利",money(s.net_profit_cents),"","green")}${metric("實收",money(s.paid_cents))}${metric("未收",money(s.outstanding_cents),"","red")}${s.investor_share_cents!==undefined?metric("我的應佔 "+num(s.investor_percentage)+"%",money(s.investor_share_cents),"","gold"):""}</div><div class="grid two" style="margin-top:14px"><div class=card><h3>每日</h3>${table(["日期","訂單","營業額","訂單利潤"],(x.by_day||[]).map(z=>[z.date,z.orders,money(z.revenue_cents),money(z.order_profit_cents)]))}</div><div class=card><h3>產品</h3>${table(["產品","數量","銷售","成本"],(x.by_product||[]).map(z=>[esc(z.name),num(z.qty),money(z.sales_cents),money(z.cost_cents)]))}</div></div>`};$("#rg").onclick=load;await load()
}
async function users(){
  if(S.user.role!=="admin")return location.hash="#/dashboard";const [u,i]=await Promise.all([req("/api/users"),req("/api/investors")]);$("#content").innerHTML=head("帳戶","管理員可修改；投資者只讀",'<button id=add class="btn primary">＋ 帳戶</button>')+`<div class=card>${table(["名稱","Email","角色","投資者","狀態"],(u.users||[]).map(x=>[esc(x.name),esc(x.email),x.role==="admin"?"管理員":"投資者",esc(x.investor_name||"-"),x.is_active?"啟用":"停用"]))}</div>`;$("#add").onclick=()=>userModal(i.investors||[],()=>users())
}
function userModal(ins,after){modal("新增帳戶",`<form id=mf>${field("名稱","name")}${field("Email","email","email")}<div class=field>${sel("角色","role",[["admin","管理員"],["investor","投資者"]],"investor")}</div><div class=field>${sel("連結投資者","investor_id",[["","不連結"],...ins.map(i=>[i.id,i.name+" ("+num(i.percentage)+"%)"])],"")}</div>${field("密碼","password","password")}<button class="btn primary">建立</button></form>`);$("#mf").onsubmit=async e=>{e.preventDefault();try{await req("/api/users",{method:"POST",body:obj(e)});closeModal();after();toast("帳戶已建立","success")}catch(er){toast(er.message,"error")}}}
async function audit(){
  if(S.user.role!=="admin")return location.hash="#/dashboard";const x=await req("/api/audit");$("#content").innerHTML=head("操作紀錄","重要新增及修改紀錄")+`<div class=card>${table(["時間","人員","動作","類型","內容"],(x.logs||[]).map(l=>[esc(l.created_at),esc(l.user_name||"-"),esc(l.action),esc(l.entity_type),esc((l.after_json||"").slice(0,120))]))}</div>`
}
async function settings(){
  if(S.user.role!=="admin")return location.hash="#/dashboard";const x=await req("/api/settings"),s=x.settings||{};$("#content").innerHTML=head("設定","公司名稱、幣別及訂單編號")+`<div class=card><form id=sf class=form-grid><div class=span2>${inp("店舖 / 公司名稱","business_name",s.business_name||"蟹帳 POS")}</div><div>${inp("幣別","currency",s.currency||"HKD")}</div><div>${inp("訂單前綴","order_prefix",s.order_prefix||"CRAB")}</div><div>${moneyInp("預設送貨成本","default_delivery_cost",+s.default_delivery_cost_cents||0)}</div><div class=span4><button class="btn primary">儲存</button></div></form></div>`;$("#sf").onsubmit=async e=>{e.preventDefault();const f=obj(e);f.default_delivery_cost_cents=cents(f.default_delivery_cost);try{await req("/api/settings",{method:"PATCH",body:f});S.settings={...S.settings,...f};toast("設定已儲存","success");shell();location.hash="#/settings";route()}catch(er){toast(er.message,"error")}}
}

function head(t,s="",a=""){return `<div class=page-head><div><h2>${esc(t)}</h2><p>${esc(s)}</p></div>${a?`<div class=actions>${a}</div>`:""}</div>`}
function metric(l,v,s="",c=""){return `<div class="card metric ${c}"><div class=label>${esc(l)}</div><div class=value>${v}</div>${s?`<div class=sub>${esc(s)}</div>`:""}</div>`}
function table(h,r){if(!r.length)return'<div class=empty>暫時沒有資料</div>';return `<div class=table-wrap><table><thead><tr>${h.map(x=>"<th>"+x+"</th>").join("")}</tr></thead><tbody>${r.map(x=>"<tr>"+x.map(y=>"<td>"+(y??"")+"</td>").join("")+"</tr>").join("")}</tbody></table></div>`}
function badge(x){return `<span class="badge ${x==="已完成"?"done":""}">${esc(x||"-")}</span>`}function payBadge(x){const m={paid:"已付款",partial:"部分付款",unpaid:"未付款",refunded:"已退款"};return `<span class="badge ${x}">${m[x]||esc(x)}</span>`}
function inp(l,n,v="",ph="",type="text"){return `<label>${esc(l)}</label><input name="${n}" type="${type}" value="${attr(v)}" placeholder="${attr(ph)}">`}function moneyInp(l,n,c=0){return `<label>${esc(l)}</label><input name="${n}" type=number step=.01 min=0 value="${((+c||0)/100).toFixed(2)}">`}function sel(l,n,ops,v){return `<label>${esc(l)}</label><select name="${n}">${ops.map(o=>`<option value="${attr(o[0])}" ${String(o[0])===String(v)?"selected":""}>${esc(o[1])}</option>`).join("")}</select>`}function field(l,n,t="text",v=""){return `<div class=field>${inp(l,n,v,"",t)}</div>`}
function modal(t,h){const d=document.createElement("div");d.id="modal";d.className="modal-backdrop";d.innerHTML=`<div class=modal><div class=modal-head><h3>${esc(t)}</h3><button id=mc class="btn small">×</button></div>${h}</div>`;document.body.appendChild(d);$("#mc").onclick=closeModal;d.onclick=e=>e.target===d&&closeModal()}function closeModal(){$("#modal")?.remove()}
function toast(x,t=""){const z=$("#toast");z.textContent=x;z.className="toast "+t;z.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>z.hidden=true,3200)}
function obj(e){return Object.fromEntries(new FormData(e.currentTarget))}function money(c){return new Intl.NumberFormat("zh-HK",{style:"currency",currency:S.settings.currency||"HKD"}).format((+c||0)/100)}function cents(v){return Math.round((+v||0)*100)}function num(v){const n=+v||0;return Number.isInteger(n)?String(n):n.toFixed(2).replace(/0+$/,"").replace(/\.$/,"")}function today(){const d=new Date(),o=d.getTimezoneOffset();return new Date(d-o*60000).toISOString().slice(0,10)}function esc(x){return String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}function attr(x){return esc(x).replace(/\`/g,"&#96;")}
if("serviceWorker"in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(()=>{}));
