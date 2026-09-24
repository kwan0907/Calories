const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const API=(window.CRAB_API_BASE||"").replace(/\/+$/,"");
const S={user:null,settings:{business_name:"蟹帳 POS",currency:"HKD",default_delivery_cost_cents:"0",customer_delivery_fee_cents:"0",free_shipping_threshold_cents:"0",free_shipping_basis:"discounted"},products:[]};
const ROLE_LABELS={admin:"管理員",staff:"員工",investor:"投資者",viewer:"只讀",customer:"客戶"};
const ROLE_DEFAULTS={
  admin:["*"],
  staff:["dashboard","orders.read","orders.write","delivery.read","customers.read","customers.write","customers.pii","products.read"],
  investor:["dashboard","orders.read","products.read","expenses.read","investors.read","reports.read"],
  viewer:["dashboard","orders.read","products.read","reports.read"],
  customer:[]
};
const PERM_LABELS=[
  ["dashboard","總覽"],["orders.read","查看訂單"],["orders.write","新增／修改訂單"],["delivery.read","查看送貨"],
  ["customers.read","查看客戶"],["customers.write","新增／修改客戶"],["customers.pii","查看客戶電話／地址"],
  ["products.read","查看產品"],["products.write","新增／修改產品"],["expenses.read","查看支出"],["expenses.write","新增支出"],
  ["investors.read","查看投資者"],["investors.write","管理投資者"],["reports.read","查看報表"],
  ["accounts.manage","管理帳戶／審批"],["audit.read","查看操作紀錄"],["settings.read","查看設定"],["settings.write","修改設定"],["export.orders","匯出訂單 CSV"]
];
const PERM_GRANTS={
  "orders.write":["orders.read","products.read","delivery.read","customers.read","customers.write","customers.pii"],
  "customers.write":["customers.read","customers.pii"],
  "products.write":["products.read"],
  "expenses.write":["expenses.read"],
  "investors.write":["investors.read"],
  "settings.write":["settings.read"],
  "accounts.manage":["investors.read"]
};

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
  closeModal();
  $("#app").innerHTML=auth("蟹帳 POS","訂單・利潤・送貨・投資者",`
  <form id="f">${field("Email","email","email")}${field("密碼","password","password")}<button class="btn primary">登入</button></form>
  <div class="auth-actions"><span class="help">未有帳戶？</span><button id="reg" type="button" class="btn">申請帳戶</button></div>`);
  $("#f").onsubmit=async e=>{e.preventDefault();try{const x=await req("/api/auth/login",{method:"POST",body:obj(e),noRedirect:true});S.user=x.user;S.settings=(await req("/api/auth/me")).settings;shell();location.hash="#/"+homeRoute();route()}catch(er){toast(er.message,"error")}};
  $("#reg").onclick=register;
}
function register(){
  $("#app").innerHTML=auth("申請帳戶","送出後由管理員審批並設定身分與權限",`
  <form id="rf">${field("姓名","name")}${field("Email","email","email")}${field("密碼（至少 10 個字元）","password","password")}${field("再次輸入密碼","confirm","password")}<button class="btn primary">送出申請</button></form>
  <div class="auth-actions"><button id="backLogin" type="button" class="btn">返回登入</button></div>`);
  $("#backLogin").onclick=login;
  $("#rf").onsubmit=async e=>{e.preventDefault();const f=obj(e);if(f.password!==f.confirm)return toast("兩次密碼不一致","error");try{await req("/api/auth/register",{method:"POST",body:{name:f.name,email:f.email,password:f.password},noRedirect:true});toast("申請已送出，等待管理員審批","success");login()}catch(er){toast(er.message,"error")}}
}
function auth(t,sub,html){return `<div class="auth-shell"><div class="auth-card"><div class="brand-big"><div class="brand-mark">蟹</div><div><h1>${t}</h1><p>${sub}</p></div></div>${html}</div></div>`}
function roleOf(){return S.user?.access_role||S.user?.role||"viewer"}
function has(p){const r=roleOf(),a=S.user?.permissions||[];if(r==="admin"||a.includes("*")||a.includes(p))return true;return a.some(x=>(PERM_GRANTS[x]||[]).includes(p))}
function homeRoute(){for(const [r,p] of [["dashboard","dashboard"],["orders","orders.read"],["products","products.read"],["reports","reports.read"],["users","accounts.manage"]])if(has(p))return r;return"noaccess"}
function shell(){
  const nav=[
    ["dashboard","⌂","總覽",has("dashboard")],["pos","＋","POS 開單",has("orders.write")],["orders","▤","訂單",has("orders.read")],["delivery","🚚","送貨",has("delivery.read")&&has("orders.read")],
    ["customers","人","客戶",has("customers.read")],["products","盒","產品",has("products.read")],["expenses","$","支出",has("expenses.read")],["investors","%","投資者",has("investors.read")],
    ["reports","▥","報表",has("reports.read")],["users","🔐","帳戶",has("accounts.manage")],["audit","↺","操作紀錄",has("audit.read")],["settings","⚙","設定",has("settings.read")]
  ].filter(x=>x[3]);
  $("#app").innerHTML=`<div class="app-shell"><aside class="sidebar"><div class="brand"><div class="brand-mark">蟹</div><div><div class="brand-title">${esc(S.settings.business_name||"蟹帳 POS")}</div><div class="brand-sub">獨立雲端 POS</div></div></div>
    <nav class="nav">${nav.map(x=>`<button data-r="${x[0]}"><span>${x[1]}</span>${x[2]}</button>`).join("")}</nav></aside>
    <main class="main"><header class="topbar"><div class="top-title">${esc(S.settings.business_name||"蟹帳 POS")}</div><div class="user-box"><span class="name">${esc(S.user.name)}</span><span class="role">${ROLE_LABELS[roleOf()]||esc(roleOf())}</span><button id="logout" class="btn small ghost">登出</button></div></header><section id="content" class="content"></section></main></div>`;
  [...document.querySelectorAll(".nav button")].forEach(b=>b.onclick=()=>location.hash="#/"+b.dataset.r);
  $("#logout").onclick=async()=>{try{await req("/api/auth/logout",{method:"POST"})}catch{}S.user=null;login()}
}
function route(){
  const raw=(location.hash||"#/dashboard").replace(/^#\//,""),[r,q=""]=raw.split("?"),p=new URLSearchParams(q);
  [...document.querySelectorAll(".nav button")].forEach(b=>b.classList.toggle("active",b.dataset.r===r));
  const map={dashboard,orders,delivery,customers,products,expenses,investors,reports,users,audit,settings,noaccess,pos:()=>pos(p.get("edit"))};
  (map[r]||noaccess)().catch(e=>{toast(e.message,"error");const box=$("#content");if(box)box.innerHTML=`<div class="empty">${esc(e.message)}</div>`})
}
async function noaccess(){
  $("#content").innerHTML=head("帳戶已啟用","目前未獲分配任何功能權限")+"<div class=empty>請聯絡管理員設定身分或權限。</div>";
}
async function dashboard(){
  const d=await req("/api/dashboard?today="+today()),finance=has("reports.read");
  $("#content").innerHTML=head("總覽","今日及本月生意狀況")+`
  <div class="grid cards">
    ${metric("今日營業額",money(d.today.revenue_cents),d.today.order_count+" 張訂單","gold")}
    ${finance?metric("今日淨利",money(d.today.net_profit_cents),"支出 "+money(d.today.expense_cents),"green"):""}
    ${metric("本月營業額",money(d.month.revenue_cents),d.month.order_count+" 張訂單")}
    ${finance?metric("本月淨利",money(d.month.net_profit_cents),"支出 "+money(d.month.expense_cents),"green"):""}
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
  if(!has("orders.write"))return location.hash="#/"+homeRoute();
  const finance=has("reports.read")||has("products.write"),ps=await getProducts(!!id),data=id?await req("/api/orders/"+encodeURIComponent(id)):null,o=data?.order||{},its=data?.items||[];
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
  <div class="section-title"><h3>金額</h3></div>
  <div class="money-tools">
    <div class="money-tool-card">
      <label>折扣快捷</label>
      <div class="discount-pills" id="discountPills">
        <button type="button" class="discount-pill" data-off="0">原價</button>
        <button type="button" class="discount-pill" data-off="5">95折</button>
        <button type="button" class="discount-pill" data-off="10">9折</button>
        <button type="button" class="discount-pill" data-off="15">85折</button>
        <button type="button" class="discount-pill" data-off="20">8折</button>
        <button type="button" class="discount-pill" data-off="custom">自訂</button>
      </div>
      <div id="customDiscountWrap" class="custom-discount is-hidden"><label>自訂折扣 %</label><input id="customDiscount" type="number" min="0" max="100" step=".1" value="0"></div>
      <input type="hidden" name="discount_percent" value="0">
      <input type="hidden" name="discount" value="${((+o.discount_cents||0)/100).toFixed(2)}">
    </div>
    <div class="money-tool-card">
      <label>客戶運費</label>
      <div class="shipping-modes">
        <button type="button" class="ship-mode" data-mode="auto">自動</button>
        <button type="button" class="ship-mode" data-mode="free">手動免運</button>
        <button type="button" class="ship-mode" data-mode="custom">自訂</button>
      </div>
      <input type="hidden" name="shipping_mode" value="auto">
      <div id="customShippingWrap" class="custom-shipping is-hidden">${moneyInp("自訂客戶運費","delivery_fee",o.delivery_fee_cents)}</div>
      <div id="shippingHint" class="shipping-hint"></div>
    </div>
  </div>
  <div class="form-grid">
    <div>${moneyInp("其他收費","other_fee",o.other_fee_cents)}</div><div>${moneyInp("實收","paid_amount",o.paid_amount_cents)}</div>
    ${finance?`<div>${moneyInp("實際送貨成本","delivery_cost",o.delivery_cost_cents??S.settings.default_delivery_cost_cents)}</div><div>${moneyInp("其他成本","other_cost",o.other_cost_cents)}</div>`:`<input type=hidden name=delivery_cost value="${((+(o.delivery_cost_cents??S.settings.default_delivery_cost_cents)||0)/100).toFixed(2)}"><input type=hidden name=other_cost value="${((+o.other_cost_cents||0)/100).toFixed(2)}">`}
    <div class="span2"><label>備註</label><textarea name="notes">${esc(o.notes||"")}</textarea></div>
  </div><div id="totals" class="totals" style="margin-top:16px"></div>
  <div class="actions" style="justify-content:flex-end;margin-top:16px"><button type="button" id="back" class="btn">返回</button><button class="btn primary">${id?"儲存修改":"完成開單"}</button></div></div></form>`;
  const box=$("#lines");
  const draw=()=>{box.innerHTML=lines.map((x,i)=>{const p=ps.find(z=>z.id===x.product_id)||ps[0];return `<div class="line-row ${finance?"":"no-cost"}" data-i="${i}">
    <div><label>產品</label><select class="lp">${ps.map(z=>`<option value="${z.id}" ${z.id===x.product_id?"selected":""}>${esc(z.category)}｜${esc(z.name)}</option>`).join("")}</select></div>
    <div><label>數量</label><input class="lq" type="number" min=".01" step=".01" value="${x.qty}"></div>
    <div class="price-col"><label>單價</label><input class="lv" type="number" min="0" step=".01" value="${(x.unit_price_cents/100).toFixed(2)}"></div>
    ${finance?`<div class="cost-col"><label>成本</label><input disabled value="${((+p.cost_cents||0)/100).toFixed(2)}"></div>`:""}<button type="button" class="btn small danger remove">×</button></div>`}).join("");
    $$(".line-row",box).forEach(r=>{const i=+r.dataset.i;$(".lp",r).onchange=e=>{const p=ps.find(z=>z.id===e.target.value);lines[i].product_id=p.id;lines[i].unit_price_cents=+p.sale_price_cents||0;draw();calc()};$(".lq",r).oninput=e=>{lines[i].qty=+e.target.value||0;calc()};$(".lv",r).oninput=e=>{lines[i].unit_price_cents=cents(e.target.value);calc()};$(".remove",r).onclick=()=>{if(lines.length>1){lines.splice(i,1);draw();calc()}}})
  };
  const standardFee=+S.settings.customer_delivery_fee_cents||0,freeThreshold=+S.settings.free_shipping_threshold_cents||0,freeBasis=S.settings.free_shipping_basis==="subtotal"?"subtotal":"discounted";
  let currentOff=0;
  const currentSub=()=>lines.reduce((sum,x)=>sum+Math.round(x.qty*x.unit_price_cents),0);
  if(id&&currentSub()>0){const inferred=(+o.discount_cents||0)/currentSub()*100;currentOff=[0,5,10,15,20].find(v=>Math.abs(v-inferred)<.05)??Math.max(0,Math.min(100,inferred))}
  const inferShipMode=()=>{if(!id)return"auto";const sub=currentSub(),disc=Math.round(sub*currentOff/100),base=freeBasis==="subtotal"?sub:Math.max(0,sub-disc),autoFee=freeThreshold>0&&base>=freeThreshold?0:standardFee,existing=+o.delivery_fee_cents||0;if(existing===autoFee)return"auto";if(existing===0)return"free";return"custom"};
  let shippingMode=inferShipMode();
  const syncDiscountUI=()=>{
    const exact=[0,5,10,15,20].some(v=>Math.abs(v-currentOff)<.05);
    $(".discount-pill").forEach(b=>b.classList.toggle("active",b.dataset.off==="custom"?!exact:+b.dataset.off===currentOff));
    $("#customDiscountWrap").classList.toggle("is-hidden",exact);
    $("#customDiscount").value=exact?"":num(currentOff);
    $('[name="discount_percent"]').value=String(currentOff);
  };
  const syncShipUI=()=>{$(".ship-mode").forEach(b=>b.classList.toggle("active",b.dataset.mode===shippingMode));$('[name="shipping_mode"]').value=shippingMode;$("#customShippingWrap").classList.toggle("is-hidden",shippingMode!=="custom")};
  const calc=()=>{
    const sub=currentSub(),cost=lines.reduce((x,y)=>x+Math.round(y.qty*(+ps.find(z=>z.id===y.product_id)?.cost_cents||0)),0),disc=Math.min(sub,Math.round(sub*currentOff/100)),discounted=Math.max(0,sub-disc),basis=freeBasis==="subtotal"?sub:discounted,autoFree=freeThreshold>0&&basis>=freeThreshold,customFee=cents($('[name="delivery_fee"]')?.value||0),df=shippingMode==="free"?0:shippingMode==="custom"?customFee:(autoFree?0:standardFee),of=cents($('[name="other_fee"]').value),dc=cents($('[name="delivery_cost"]').value),oc=cents($('[name="other_cost"]').value),total=Math.max(0,discounted+df+of),net=total-cost-dc-oc;
    $('[name="discount"]').value=(disc/100).toFixed(2);
    const diff=Math.max(0,freeThreshold-basis),basisLabel=freeBasis==="subtotal"?"折扣前商品額":"折扣後商品額";
    $("#shippingHint").innerHTML=shippingMode==="auto"
      ?(freeThreshold<=0?`自動運費：${money(standardFee)}｜未設定滿額免運`:autoFree?`✓ 已達免運門檻（${basisLabel} ${money(basis)}）`:`自動運費 ${money(standardFee)}｜尚差 ${money(diff)} 免運`)
      :shippingMode==="free"?"手動免運：客戶運費 $0；實際送貨成本仍會扣除":"使用自訂客戶運費";
    $("#totals").innerHTML=`<div class="total-row"><span>商品小計</span><b>${money(sub)}</b></div><div class="total-row"><span>折扣（${num(currentOff)}%）</span><b>-${money(disc)}</b></div><div class="total-row"><span>客戶運費</span><b>${money(df)}</b></div>${finance?`<div class="total-row"><span>商品成本</span><b>${money(cost)}</b></div><div class="total-row"><span>實際送貨成本</span><b>${money(dc)}</b></div>`:""}<div class="total-row grand"><span>應收總額</span><b>${money(total)}</b></div>${finance?`<div class="total-row profit"><span>此單淨利</span><b>${money(net)}</b></div>`:""}`;
  };
  $(".discount-pill").forEach(b=>b.onclick=()=>{if(b.dataset.off==="custom"){$("#customDiscountWrap").classList.remove("is-hidden");currentOff=Math.max(0,Math.min(100,+$("#customDiscount").value||0))}else currentOff=+b.dataset.off;syncDiscountUI();calc()});
  $("#customDiscount").oninput=e=>{currentOff=Math.max(0,Math.min(100,+e.target.value||0));$('[name="discount_percent"]').value=String(currentOff);calc()};
  $(".ship-mode").forEach(b=>b.onclick=()=>{shippingMode=b.dataset.mode;syncShipUI();calc()});
  syncDiscountUI();syncShipUI();draw();calc();
  $("#addLine").onclick=()=>{lines.push({product_id:ps[0].id,qty:1,unit_price_cents:+ps[0].sale_price_cents||0});draw();calc()};
  $('input[name="delivery_fee"],input[name="other_fee"],input[name="delivery_cost"],input[name="other_cost"]').forEach(x=>x.oninput=calc);
  $("#back").onclick=()=>location.hash="#/orders";
  $("#orderForm").onsubmit=async e=>{e.preventDefault();const f=obj(e),payload={order_no:f.order_no,order_date:f.order_date,status:f.status,payment_method:f.payment_method,delivery_date:f.delivery_date,delivery_slot:f.delivery_slot,delivery_person:f.delivery_person,delivery_status:f.delivery_status,customer:{name:f.customer_name||"散客",phone:f.customer_phone,address:f.customer_address},items:lines,discount_percent:+f.discount_percent||0,discount_cents:cents(f.discount),shipping_mode:f.shipping_mode,delivery_fee_cents:cents(f.delivery_fee),other_fee_cents:cents(f.other_fee),paid_amount_cents:cents(f.paid_amount),delivery_cost_cents:cents(f.delivery_cost),other_cost_cents:cents(f.other_cost),notes:f.notes};try{const x=await req(id?"/api/orders/"+id:"/api/orders",{method:id?"PATCH":"POST",body:payload});toast("已儲存 "+x.order_no,"success");location.hash="#/orders"}catch(er){toast(er.message,"error")}}
}
async function orders(){
  if(!has("orders.read"))return location.hash="#/"+homeRoute();
  const a=has("orders.write"),pii=has("customers.pii"),finance=has("reports.read"),canExport=has("export.orders");$("#content").innerHTML=head("訂單","搜尋、收款、利潤及送貨",a?'<button id="newO" class="btn primary">＋ 新訂單</button>':"")+`
  <div class="filters"><input id="q" placeholder="${pii?"訂單 / 客戶 / 電話":"訂單編號"}"><input id="from" type="date"><input id="to" type="date"><select id="pay"><option value="">全部付款</option><option value="unpaid">未付款</option><option value="partial">部分付款</option><option value="paid">已付款</option></select><button id="go" class="btn">搜尋</button>${canExport?'<button id="csv" class="btn">CSV</button>':""}</div><div id="box" class="card"></div>`;
  if(a)$("#newO").onclick=()=>location.hash="#/pos";
  const load=async()=>{const p=new URLSearchParams();["q","from","to"].forEach(k=>{$("#"+k).value&&p.set(k,$("#"+k).value)});$("#pay").value&&p.set("payment",$("#pay").value);const x=await req("/api/orders?"+p),headers=["訂單","客戶","內容","總額","付款"],rows=(x.orders||[]).map(o=>[`<b>${esc(o.order_no)}</b><div class=muted>${esc(o.order_date)}</div>`,pii?`${esc(o.customer_name||"散客")}<div class=muted>${esc(o.customer_phone||"")}</div>`:"已隱藏客戶資料",esc(o.item_summary||""),money(o.total_cents),payBadge(o.payment_status)]);if(finance){headers.push("淨利");rows.forEach((r,i)=>{const o=x.orders[i];r.push(`<span class="${+o.net_profit_cents>=0?"positive":"negative"}">${money(o.net_profit_cents)}</span>`)})}headers.push("送貨","");rows.forEach((r,i)=>{const o=x.orders[i];r.push(`${badge(o.delivery_status)}<div class=muted>${esc(o.delivery_date||"")}</div>`,a?`<button class="btn small edit" data-id="${o.id}">修改</button>`:"")});$("#box").innerHTML=table(headers,rows);[...document.querySelectorAll(".edit")].forEach(b=>b.onclick=()=>location.hash="#/pos?edit="+encodeURIComponent(b.dataset.id))};
  $("#go").onclick=load;$("#q").onkeydown=e=>e.key==="Enter"&&load();
  if(canExport)$("#csv").onclick=async()=>{try{const r=await fetch(API+"/api/export/orders.csv",{credentials:"include"});if(!r.ok)throw Error("匯出失敗");const b=await r.blob(),u=URL.createObjectURL(b),a=document.createElement("a");a.href=u;a.download="crab-pos-orders.csv";a.click();URL.revokeObjectURL(u)}catch(e){toast(e.message,"error")}};
  await load()
}
async function delivery(){
  if(!has("delivery.read")||!has("orders.read"))return location.hash="#/"+homeRoute();
  const x=await req("/api/orders?delivery_from="+today()),rows=(x.orders||[]).filter(o=>o.delivery_date&&["confirmed","completed"].includes(o.status)).sort((a,b)=>String(a.delivery_date).localeCompare(String(b.delivery_date)));
  $("#content").innerHTML=head("送貨","由訂單內管理日期、時段、配送員及狀態")+`<div class="card">${table(["日期","訂單","內容","配送","狀態",""],rows.map(o=>[`${esc(o.delivery_date)}<div class=muted>${esc(o.delivery_slot||"")}</div>`,esc(o.order_no),esc(o.item_summary||""),esc(o.delivery_person||"-"),badge(o.delivery_status),has("orders.write")?`<button class="btn small de" data-id="${o.id}">修改訂單</button>`:""]))}</div>`;$$(".de").forEach(b=>b.onclick=()=>location.hash="#/pos?edit="+b.dataset.id)
}
async function customers(){
  if(!has("customers.read"))return location.hash="#/"+homeRoute();const w=has("customers.write"),pii=has("customers.pii");
  $("#content").innerHTML=head("客戶","客戶私隱由帳戶權限控制",w?'<button id="add" class="btn primary">＋ 客戶</button>':"")+`<div class="filters"><input id="cq" placeholder="${pii?"姓名 / 電話":"姓名"}"><button id="find" class="btn">搜尋</button></div><div id="box" class="card"></div>`;
  const load=async()=>{const x=await req("/api/customers?q="+encodeURIComponent($("#cq").value||""));$("#box").innerHTML=table(["客戶","電話","地址","訂單","累計消費",""],(x.customers||[]).map(c=>[esc(c.name),pii?esc(c.phone):"已隱藏",pii?esc(c.address):"已隱藏",c.order_count,money(c.lifetime_value_cents),w?`<button class="btn small ce" data-id="${c.id}">修改</button>`:""]));if(w)[...document.querySelectorAll(".ce")].forEach(b=>b.onclick=()=>customerModal(x.customers.find(c=>c.id===b.dataset.id),load))};if(w)$("#add").onclick=()=>customerModal(null,load);$("#find").onclick=load;await load()
}
function customerModal(c,after){modal(c?"修改客戶":"新增客戶",`<form id="mf">${field("姓名","name","text",c?.name||"")}${field("電話","phone","text",c?.phone||"")}${field("地址","address","text",c?.address||"")}<div class=field><label>備註</label><textarea name=notes>${esc(c?.notes||"")}</textarea></div><button class="btn primary">儲存</button></form>`);$("#mf").onsubmit=async e=>{e.preventDefault();try{await req(c?"/api/customers/"+c.id:"/api/customers",{method:c?"PATCH":"POST",body:obj(e)});closeModal();await after();toast("已儲存","success")}catch(er){toast(er.message,"error")}}}
async function products(){
  if(!has("products.read"))return location.hash="#/"+homeRoute();const a=has("products.write"),finance=has("reports.read")||a,ps=await getProducts(a),headers=["產品","分類","售價"],rows=ps.map(p=>[`<b>${esc(p.name)}</b><div class=muted>${esc(p.sku||"")}</div>`,esc(p.category),money(p.sale_price_cents)]);if(finance){headers.push("成本","毛利");rows.forEach((r,i)=>{const p=ps[i];r.push(money(p.cost_cents),money((+p.sale_price_cents||0)-(+p.cost_cents||0)))})}headers.push("庫存","狀態","");rows.forEach((r,i)=>{const p=ps[i];r.push(p.track_stock?num(p.stock_qty)+" "+esc(p.unit):"不追蹤",p.is_active?"上架":"停用",a?`<button class="btn small pe" data-id="${p.id}">修改</button>`:"")});$("#content").innerHTML=head("產品","售價、成本、分類及庫存",a?'<button id="add" class="btn primary">＋ 產品</button>':"")+`<div class=card>${table(headers,rows)}</div>`;if(a){$("#add").onclick=()=>productModal(null,()=>products());[...document.querySelectorAll(".pe")].forEach(b=>b.onclick=()=>productModal(ps.find(p=>p.id===b.dataset.id),()=>products()))}}
function productModal(p,after){modal(p?"修改產品":"新增產品",`<form id=mf><div class=form-grid><div class=span2>${inp("產品名稱","name",p?.name||"")}</div><div>${inp("分類","category",p?.category||"其他")}</div><div>${inp("SKU","sku",p?.sku||"")}</div><div>${inp("單位","unit",p?.unit||"隻")}</div><div>${moneyInp("成本","cost",p?.cost_cents)}</div><div>${moneyInp("售價","price",p?.sale_price_cents)}</div><div>${`<label>庫存</label><input name="stock_qty" type="number" min="0" step=".01" value="${attr(p?.stock_qty??0)}">`}</div><div>${sel("追蹤庫存","track_stock",[["0","否"],["1","是"]],String(p?.track_stock||0))}</div><div>${sel("狀態","is_active",[["1","上架"],["0","停用"]],String(p?.is_active??1))}</div></div><button class="btn primary">儲存</button></form>`);$("#mf").onsubmit=async e=>{e.preventDefault();const f=obj(e),b={...f,cost_cents:cents(f.cost),sale_price_cents:cents(f.price),stock_qty:+f.stock_qty||0,track_stock:+f.track_stock,is_active:+f.is_active};try{await req(p?"/api/products/"+p.id:"/api/products",{method:p?"PATCH":"POST",body:b});closeModal();await after();toast("產品已儲存","success")}catch(er){toast(er.message,"error")}}}
async function expenses(){
  if(!has("expenses.read"))return location.hash="#/"+homeRoute();const a=has("expenses.write"),from=today().slice(0,7)+"-01",x=await req("/api/expenses?from="+from+"&to="+today()),items=x.expenses||[];$("#content").innerHTML=head("支出","營運支出會從報表淨利扣除",a?'<button id="add" class="btn primary">＋ 支出</button>':"")+`<div class=card>${table(["日期","類型","說明","金額","備註",""],items.map(e=>[esc(e.expense_date),esc(e.type),esc(e.description),money(e.amount_cents),esc(e.notes||""),a?`<button class="btn small xe" data-id="${e.id}">修改</button>`:""]))}</div>`;if(a){$("#add").onclick=()=>expenseModal(null,()=>expenses());[...document.querySelectorAll(".xe")].forEach(b=>b.onclick=()=>expenseModal(items.find(x=>x.id===b.dataset.id),()=>expenses()))}
}
function expenseModal(x,after){modal(x?"修改支出":"新增支出",`<form id=mf>${field("日期","expense_date","date",x?.expense_date||today())}${field("類型","type","text",x?.type||"其他")}${field("說明","description","text",x?.description||"")}${`<div class=field>${moneyInp("金額","amount",x?.amount_cents)}</div>`}<div class=field><label>備註</label><textarea name=notes>${esc(x?.notes||"")}</textarea></div><button class="btn primary">儲存</button></form>`);$("#mf").onsubmit=async e=>{e.preventDefault();const f=obj(e);f.amount_cents=cents(f.amount);try{await req(x?"/api/expenses/"+x.id:"/api/expenses",{method:x?"PATCH":"POST",body:f});closeModal();await after();toast(x?"支出已更新":"支出已新增","success")}catch(er){toast(er.message,"error")}}}
async function investors(){
  if(!has("investors.read"))return location.hash="#/"+homeRoute();const a=has("investors.write"),x=await req("/api/investors"),items=x.investors||[];$("#content").innerHTML=head("投資者","投資比例及應佔利潤基礎",a?'<button id="add" class="btn primary">＋ 投資者</button>':"")+`<div class=card>${table(["名稱","比例","狀態","備註",""],items.map(i=>[esc(i.name),num(i.percentage)+"%",i.is_active?"啟用":"停用",esc(i.notes||""),a?`<button class="btn small ie" data-id="${i.id}">修改</button>`:""]))}</div>`;if(a){$("#add").onclick=()=>investorModal(null,()=>investors());[...document.querySelectorAll(".ie")].forEach(b=>b.onclick=()=>investorModal(items.find(x=>x.id===b.dataset.id),()=>investors()))}
}
function investorModal(x,after){modal(x?"修改投資者":"新增投資者",`<form id=mf>${field("名稱","name","text",x?.name||"")}${`<div class=field><label>比例 %</label><input name="percentage" type="number" min="0" max="100" step=".01" value="${attr(x?.percentage??0)}"></div>`}<div class=field>${sel("狀態","is_active",[["1","啟用"],["0","停用"]],String(x?.is_active??1))}</div><div class=field><label>備註</label><textarea name=notes>${esc(x?.notes||"")}</textarea></div><button class="btn primary">儲存</button></form>`);$("#mf").onsubmit=async e=>{e.preventDefault();const f=obj(e);f.percentage=+f.percentage||0;f.is_active=+f.is_active;try{await req(x?"/api/investors/"+x.id:"/api/investors",{method:x?"PATCH":"POST",body:f});closeModal();await after();toast(x?"投資者已更新":"投資者已新增","success")}catch(er){toast(er.message,"error")}}}
async function reports(){
  if(!has("reports.read"))return location.hash="#/"+homeRoute();const f=today().slice(0,7)+"-01",t=today();$("#content").innerHTML=head("報表","收入、成本、支出及淨利")+`<div class=filters><input id=rf type=date value="${f}"><input id=rt type=date value="${t}"><button id=rg class=btn>更新</button></div><div id=rb></div>`;
  const load=async()=>{const x=await req(`/api/reports/summary?from=${$("#rf").value}&to=${$("#rt").value}`),s=x.summary;$("#rb").innerHTML=`<div class="grid cards">${metric("營業額",money(s.revenue_cents),s.order_count+" 張訂單","gold")}${metric("商品成本",money(s.product_cost_cents))}${metric("營運支出",money(s.expense_cents))}${metric("淨利",money(s.net_profit_cents),"","green")}${metric("實收",money(s.paid_cents))}${metric("未收",money(s.outstanding_cents),"","red")}${s.investor_share_cents!==undefined?metric("我的應佔 "+num(s.investor_percentage)+"%",money(s.investor_share_cents),"","gold"):""}</div><div class="grid two" style="margin-top:14px"><div class=card><h3>每日</h3>${table(["日期","訂單","營業額","訂單利潤"],(x.by_day||[]).map(z=>[z.date,z.orders,money(z.revenue_cents),money(z.order_profit_cents)]))}</div><div class=card><h3>產品</h3>${table(["產品","數量","銷售","成本"],(x.by_product||[]).map(z=>[esc(z.name),num(z.qty),money(z.sales_cents),money(z.cost_cents)]))}</div></div>`};$("#rg").onclick=load;await load()
}
async function users(){
  if(!has("accounts.manage"))return location.hash="#/"+homeRoute();const [u,i]=await Promise.all([req("/api/users"),req("/api/investors")]),all=u.users||[],pending=all.filter(x=>x.account_status==="pending"),active=all.filter(x=>x.account_status==="active"),rejected=all.filter(x=>x.account_status==="rejected");
  const rows=list=>table(["名稱","Email","身分","投資者","狀態","申請時間",""],list.map(x=>[esc(x.name),esc(x.email),ROLE_LABELS[x.access_role]||esc(x.access_role||"-"),esc(x.investor_name||"-"),accountBadge(x.account_status,x.is_active),esc(x.requested_at||x.created_at||"-"),`<button class="btn small ue" data-id="${x.id}">${x.account_status==="pending"?"審批":"設定"}</button>`]));
  $("#content").innerHTML=head("帳戶",`全部 ${all.length} 個；待審批 ${pending.length} 個`,'<button id=add class="btn primary">＋ 帳戶</button>')+
    `<div class="account-tabs"><button class="tab active" data-tab="all">全部 (${all.length})</button><button class="tab" data-tab="pending">待審批 (${pending.length})</button><button class="tab" data-tab="active">已啟用 (${active.length})</button><button class="tab" data-tab="rejected">已拒絕 (${rejected.length})</button></div>
    <div id="userList" class="card">${rows(all)}</div>`;
  const data={all,pending,active,rejected};[...document.querySelectorAll(".tab")].forEach(b=>b.onclick=()=>{[...document.querySelectorAll(".tab")].forEach(x=>x.classList.toggle("active",x===b));$("#userList").innerHTML=rows(data[b.dataset.tab]);bind()});
  const bind=()=>[...document.querySelectorAll(".ue")].forEach(b=>b.onclick=()=>manageUserModal(all.find(x=>x.id===b.dataset.id),i.investors||[],()=>users()));
  bind();$("#add").onclick=()=>userModal(i.investors||[],()=>users())
}
function permsHtml(selected=[]){return `<div class="perm-grid">${PERM_LABELS.map(([k,l])=>`<label class="perm-item"><input type="checkbox" name="perm" value="${attr(k)}" ${selected.includes("*")||selected.includes(k)?"checked":""}><span>${esc(l)}</span></label>`).join("")}</div>`}
function roleOptions(v){return sel("身分","access_role",[["admin","管理員"],["staff","員工"],["investor","投資者"],["viewer","只讀"],["customer","客戶（暫無後台功能）"]],v)}
function collectPerms(form,role){if(role==="admin")return["*"];return [...form.querySelectorAll('input[name="perm"]:checked')].map(x=>x.value)}
function wireRoleDefaults(form,roleSel){roleSel.onchange=()=>{const d=ROLE_DEFAULTS[roleSel.value]||[];form.querySelectorAll('input[name="perm"]').forEach(x=>x.checked=d.includes("*")||d.includes(x.value))}}
function toggleInvestorLink(form,roleSel){const box=form.querySelector("[data-investor-link]");if(!box)return;box.classList.toggle("is-hidden",roleSel.value!=="investor");if(roleSel.value!=="investor"){const x=box.querySelector('[name="investor_id"]');if(x)x.value=""}}
function userModal(ins,after){
  const def="staff";
  modal("新增帳戶",`<form id=mf class="account-form">${field("名稱","name")}${field("Email","email","email")}<div class=field>${roleOptions(def)}</div><div class="field is-hidden" data-investor-link>${sel("連結投資者（只適用投資者）","investor_id",[["","不連結"],...ins.map(i=>[i.id,i.name+" ("+num(i.percentage)+"%)"])],"")}</div>${field("密碼","password","password")}<div class=field><label>權限</label>${permsHtml(ROLE_DEFAULTS[def])}</div><div class="modal-savebar"><div class="form-status" aria-live="polite"></div><button id=userSave type=button class="btn primary">建立帳戶</button></div></form>`);
  const f=$("#mf"),rs=f.querySelector('[name="access_role"]'),btn=$("#userSave"),status=f.querySelector(".form-status");
  wireRoleDefaults(f,rs);
  const oldChange=rs.onchange;
  rs.onchange=()=>{oldChange();toggleInvestorLink(f,rs)};
  toggleInvestorLink(f,rs);
  btn.onclick=async()=>{
    const b=Object.fromEntries(new FormData(f));
    b.permissions=collectPerms(f,b.access_role);
    btn.disabled=true;btn.textContent="建立中…";status.textContent="正在建立帳戶…";status.className="form-status";
    try{
      await req("/api/users",{method:"POST",body:b});
      status.textContent="已建立";status.className="form-status success";toast("帳戶已建立","success");
      setTimeout(()=>{closeModal();Promise.resolve(after()).catch(er=>toast(er.message,"error"))},250);
    }catch(er){
      btn.disabled=false;btn.textContent="建立帳戶";status.textContent=er.message;status.className="form-status error";toast(er.message,"error");
    }
  };
}
function manageUserModal(u,ins,after){
  const selected=u.permissions||ROLE_DEFAULTS[u.access_role]||[];
  modal(u.account_status==="pending"?"審批帳戶":"帳戶設定",`<form id=mf class="account-form"><div class=form-grid><div>${inp("名稱","name",u.name||"")}</div><div>${inp("Email","email",u.email||"","","email")}</div></div><div class=field>${sel("審批狀態","account_status",[["active","批准／啟用"],["pending","待審批"],["rejected","拒絕"]],u.account_status||"pending")}</div><div class=field>${roleOptions(u.access_role||"viewer")}</div><div class=field data-investor-link>${sel("連結投資者（只適用投資者）","investor_id",[["","不連結"],...ins.map(i=>[i.id,i.name+" ("+num(i.percentage)+"%)"])],u.investor_id||"")}</div><div class=field>${inp("重設密碼（留空＝不修改）","password","","至少 10 個字元","password")}</div><div class=field><label>權限</label>${permsHtml(selected)}</div><div class="modal-savebar"><div class="form-status" aria-live="polite"></div><button id=userSave type=button class="btn primary">儲存帳戶設定</button></div></form>`);
  const f=$("#mf"),rs=f.querySelector('[name="access_role"]'),btn=$("#userSave"),status=f.querySelector(".form-status");
  wireRoleDefaults(f,rs);
  const oldChange=rs.onchange;
  rs.onchange=()=>{oldChange();toggleInvestorLink(f,rs)};
  toggleInvestorLink(f,rs);
  btn.onclick=async()=>{
    const b=Object.fromEntries(new FormData(f));
    b.permissions=collectPerms(f,b.access_role);
    btn.disabled=true;btn.textContent="儲存中…";status.textContent="正在儲存…";status.className="form-status";
    try{
      await req("/api/users/"+u.id,{method:"PATCH",body:b});
      if(u.id===S.user.id){S.user.name=b.name;S.user.email=b.email}
      const msg=u.id===S.user.id?"帳戶設定已更新":"帳戶設定已更新；對方需重新登入";status.textContent="已儲存";status.className="form-status success";toast(msg,"success");
      setTimeout(()=>{closeModal();Promise.resolve(after()).catch(er=>toast(er.message,"error"))},250);
    }catch(er){
      btn.disabled=false;btn.textContent="儲存帳戶設定";status.textContent=er.message;status.className="form-status error";toast(er.message,"error");
    }
  };
}
function accountBadge(s,on){const m={pending:"待審批",active:on?"已啟用":"已停用",rejected:"已拒絕"};return `<span class="badge ${s==="active"&&on?"done":s==="pending"?"partial":"unpaid"}">${m[s]||esc(s)}</span>`}
async function audit(){
  if(!has("audit.read"))return location.hash="#/"+homeRoute();const x=await req("/api/audit");$("#content").innerHTML=head("操作紀錄","重要新增及修改紀錄")+`<div class=card>${table(["時間","人員","動作","類型","內容"],(x.logs||[]).map(l=>[esc(l.created_at),esc(l.user_name||"-"),esc(l.action),esc(l.entity_type),esc((l.after_json||"").slice(0,120))]))}</div>`
}
async function settings(){
  if(!has("settings.read"))return location.hash="#/"+homeRoute();const x=await req("/api/settings"),s=x.settings||{};$("#content").innerHTML=head("設定","公司資料、運費及免運規則")+`<div class=card><form id=sf class=form-grid>
  <div class=span2>${inp("店舖 / 公司名稱","business_name",s.business_name||"蟹帳 POS")}</div><div>${inp("幣別","currency",s.currency||"HKD")}</div><div>${inp("訂單前綴","order_prefix",s.order_prefix||"CRAB")}</div>
  <div>${moneyInp("標準客戶運費","customer_delivery_fee",+s.customer_delivery_fee_cents||0)}</div>
  <div>${moneyInp("滿額免運門檻","free_shipping_threshold",+s.free_shipping_threshold_cents||0)}</div>
  <div><label>免運判斷基準</label><select name="free_shipping_basis"><option value="discounted" ${s.free_shipping_basis!=="subtotal"?"selected":""}>折扣後商品額</option><option value="subtotal" ${s.free_shipping_basis==="subtotal"?"selected":""}>折扣前商品額</option></select></div>
  <div>${moneyInp("實際送貨成本（預設）","default_delivery_cost",+s.default_delivery_cost_cents||0)}</div>
  <div class="span4 help">「客戶運費」係客人支付嘅金額；「實際送貨成本」係你支付俾司機／物流嘅成本。即使免運，實際送貨成本仍然會從淨利扣除。免運門檻填 0 代表不啟用自動滿額免運。</div>
  <div class=span4>${has("settings.write")?'<button class="btn primary">儲存設定</button>':'<div class="help">你只有查看設定權限</div>'}</div></form></div>`;
  if(has("settings.write"))$("#sf").onsubmit=async e=>{e.preventDefault();const f=obj(e);f.default_delivery_cost_cents=cents(f.default_delivery_cost);f.customer_delivery_fee_cents=cents(f.customer_delivery_fee);f.free_shipping_threshold_cents=cents(f.free_shipping_threshold);try{await req("/api/settings",{method:"PATCH",body:f});const fresh=await req("/api/settings");S.settings={...S.settings,...(fresh.settings||{})};toast("設定已儲存","success");shell();location.hash="#/settings";route()}catch(er){toast(er.message,"error")}}
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
