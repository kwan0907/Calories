const COOKIE="crab_pos_session",DAYS=7,ITER=100000;
const ROLE_PERMISSIONS={
  admin:["*"],
  staff:["dashboard","orders.read","orders.write","delivery.read","customers.read","customers.write","customers.pii","products.read"],
  investor:["dashboard","orders.read","products.read","expenses.read","investors.read","reports.read"],
  viewer:["dashboard","orders.read","products.read","reports.read"],
  customer:[]
};
const KNOWN_PERMISSIONS=["dashboard","orders.read","orders.write","orders.delete","delivery.read","customers.read","customers.write","customers.pii","products.read","products.write","expenses.read","expenses.write","investors.read","investors.write","reports.read","accounts.manage","audit.read","settings.read","settings.write","export.orders"];
const PERM_GRANTS={
  "orders.write":["orders.read","products.read","delivery.read","customers.read","customers.write","customers.pii"],
  "orders.delete":["orders.read"],
  "customers.write":["customers.read","customers.pii"],
  "products.write":["products.read"],
  "expenses.write":["expenses.read"],
  "investors.write":["investors.read"],
  "settings.write":["settings.read"],
  "accounts.manage":["investors.read"]
};

export default{
  async fetch(req,env){
    const u=new URL(req.url);
    if(req.method==="OPTIONS") return cors(new Response(null,{status:204}),req,env);
    try{
      if(u.pathname.startsWith("/api/")) return cors(await api(req,env,u),req,env);
      return env.ASSETS.fetch(req);
    }catch(e){
      console.error(e);
      const status=e.status||500;
      return cors(j({ok:false,message:status===500?"伺服器發生錯誤":e.message},status),req,env);
    }
  }
};

async function api(req,env,u){
  const m=req.method,p=u.pathname;
  if(!env.DB) return j({ok:false,message:"D1 尚未綁定"},500);

  if(p==="/api/health") return j({ok:true,service:"crab-pos"});
  if(p==="/api/setup/status"){
    const r=await env.DB.prepare("SELECT COUNT(*) n FROM users").first();
    return j({ok:true,needs_setup:Number(r?.n||0)===0});
  }
  if(p==="/api/setup"&&m==="POST"){
    const r=await env.DB.prepare("SELECT COUNT(*) n FROM users").first();
    if(Number(r?.n||0)>0) return j({ok:false,message:"首次設定已完成"},403);
    const b=await body(req);
    if(!env.SETUP_KEY||b.setup_key!==env.SETUP_KEY) return j({ok:false,message:"Setup Key 不正確"},403);
    return createFirstAdmin(env,b);
  }
  if(p==="/api/auth/register"&&m==="POST"){
    const b=await body(req),name=s(b.name,80),email=s(b.email,180).toLowerCase(),pw=String(b.password||"");
    if(!name||!email.includes("@")||pw.length<10) throw bad("名稱、Email 必填；密碼至少 10 個字元");
    const exists=await env.DB.prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE LIMIT 1").bind(email).first();
    if(exists) throw bad("這個 Email 已經申請或建立過帳戶",409);
    const ph=await pass(pw),id=crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO users(id,name,email,password_hash,password_salt,role,investor_id,is_active,account_status,access_role,permissions_json,requested_at)
      VALUES(?,?,?,?,?,'investor',NULL,0,'pending','viewer','[]',CURRENT_TIMESTAMP)`).bind(id,name,email,ph.hash,ph.salt).run();
    await audit(env,null,"REGISTER","user",id,null,{name,email,status:"pending"});
    return j({ok:true,message:"申請已送出，等待管理員審批"},201);
  }
  if(p==="/api/auth/login"&&m==="POST"){
    const b=await body(req),email=s(b.email,180).toLowerCase(),pw=String(b.password||"");
    const user=await env.DB.prepare(`SELECT u.*,i.name investor_name,i.percentage investor_percentage
      FROM users u LEFT JOIN investors i ON i.id=u.investor_id WHERE u.email=? COLLATE NOCASE LIMIT 1`).bind(email).first();
    if(!user||!(await verify(pw,user.password_salt,user.password_hash))) return j({ok:false,message:"Email 或密碼不正確"},401);
    if(user.account_status==="pending") return j({ok:false,message:"帳戶正在等待管理員審批"},403);
    if(user.account_status==="rejected") return j({ok:false,message:"帳戶申請未獲批准"},403);
    if(!user.is_active) return j({ok:false,message:"帳戶已停用"},403);
    return sessionResponse(env,user.id,{ok:true,user:safeUser(user)});
  }
  if(p==="/api/auth/logout"&&m==="POST"){
    const t=cookie(req,COOKIE); if(t) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha(t)).run();
    return j({ok:true},200,{"Set-Cookie":clearCookie()});
  }

  const user=await currentUser(req,env);
  if(!user) return j({ok:false,message:"請先登入"},401);
  if(p==="/api/auth/me") return j({ok:true,user:safeUser(user),settings:await settings(env)});

  if(p==="/api/dashboard"){
    need(user,"dashboard");
    const today=s(u.searchParams.get("today")||dateNow(),10),start=today.slice(0,7)+"-01";
    const [t,mo,te,me,top,del]=await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) order_count,COALESCE(SUM(total_cents),0) revenue_cents,COALESCE(SUM(net_profit_cents),0) order_profit_cents,
        COALESCE(SUM(CASE WHEN total_cents>paid_amount_cents THEN total_cents-paid_amount_cents ELSE 0 END),0) unpaid_cents
        FROM orders WHERE deleted_at IS NULL AND order_date=? AND status IN ('confirmed','completed')`).bind(today).first(),
      env.DB.prepare(`SELECT COUNT(*) order_count,COALESCE(SUM(total_cents),0) revenue_cents,COALESCE(SUM(net_profit_cents),0) order_profit_cents,
        COALESCE(SUM(CASE WHEN total_cents>paid_amount_cents THEN total_cents-paid_amount_cents ELSE 0 END),0) unpaid_cents
        FROM orders WHERE deleted_at IS NULL AND order_date BETWEEN ? AND ? AND status IN ('confirmed','completed')`).bind(start,today).first(),
      env.DB.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM expenses WHERE expense_date=?").bind(today).first(),
      env.DB.prepare("SELECT COALESCE(SUM(amount_cents),0) n FROM expenses WHERE expense_date BETWEEN ? AND ?").bind(start,today).first(),
      env.DB.prepare(`SELECT oi.product_name_snapshot name,SUM(oi.qty) qty,SUM(oi.line_total_cents) sales_cents
        FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.deleted_at IS NULL AND o.order_date BETWEEN ? AND ? AND o.status IN ('confirmed','completed')
        GROUP BY oi.product_name_snapshot ORDER BY sales_cents DESC LIMIT 5`).bind(start,today).all(),
      env.DB.prepare(`SELECT id,order_no,delivery_date,delivery_slot,delivery_person,delivery_status,total_cents
        FROM orders WHERE deleted_at IS NULL AND delivery_date>=? AND status IN ('confirmed','completed') AND delivery_status!='已完成' ORDER BY delivery_date LIMIT 10`).bind(today).all()
    ]);
    const out={ok:true,today:{...nums(t),expense_cents:+te.n||0,net_profit_cents:(+t.order_profit_cents||0)-(+te.n||0)},
      month:{...nums(mo),expense_cents:+me.n||0,net_profit_cents:(+mo.order_profit_cents||0)-(+me.n||0)},
      top_products:top.results||[],deliveries:del.results||[]};
    const finance=can(user,"reports.read");
    if(roleOf(user)==="investor"&&finance) out.investor={name:user.investor_name||user.name,percentage:+user.investor_percentage||0,
      estimated_share_cents:Math.round(out.month.net_profit_cents*(+user.investor_percentage||0)/100)};
    if(!finance){
      for(const x of [out.today,out.month]){delete x.order_profit_cents;delete x.expense_cents;delete x.net_profit_cents}
    }
    return j(out);
  }

  if(p==="/api/products"&&m==="GET"){
    need(user,"products.read");
    const all=(can(user,"products.write")||can(user,"orders.write"))&&u.searchParams.get("all")==="1";
    const r=await env.DB.prepare(`SELECT * FROM products ${all?"":"WHERE is_active=1"} ORDER BY category,name`).all();
    let products=r.results||[];
    if(!can(user,"reports.read")&&!can(user,"products.write")) products=products.map(x=>{const y={...x};delete y.cost_cents;return y});
    return j({ok:true,products});
  }
  if(p==="/api/products"&&m==="POST"){
    need(user,"products.write"); const b=await body(req),x=product(b),id=crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO products(id,sku,category,name,unit,cost_cents,sale_price_cents,track_stock,stock_qty,is_active) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .bind(id,x.sku,x.category,x.name,x.unit,x.cost_cents,x.sale_price_cents,x.track_stock,x.stock_qty,x.is_active),
      env.DB.prepare("INSERT INTO product_cost_history(id,product_id,cost_cents,changed_by) VALUES(?,?,?,?)").bind(crypto.randomUUID(),id,x.cost_cents,user.id)
    ]);
    await audit(env,user.id,"CREATE","product",id,null,x); return j({ok:true,id},201);
  }
  let mm=p.match(/^\/api\/products\/([^/]+)$/);
  if(mm&&m==="PATCH"){
    need(user,"products.write"); const id=mm[1],old=await env.DB.prepare("SELECT * FROM products WHERE id=?").bind(id).first(); if(!old)return nf();
    const x=product({...old,...await body(req)}),q=[env.DB.prepare(`UPDATE products SET sku=?,category=?,name=?,unit=?,cost_cents=?,sale_price_cents=?,track_stock=?,stock_qty=?,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(x.sku,x.category,x.name,x.unit,x.cost_cents,x.sale_price_cents,x.track_stock,x.stock_qty,x.is_active,id)];
    if(+old.cost_cents!==x.cost_cents) q.push(env.DB.prepare("INSERT INTO product_cost_history(id,product_id,cost_cents,changed_by) VALUES(?,?,?,?)").bind(crypto.randomUUID(),id,x.cost_cents,user.id));
    await env.DB.batch(q); await audit(env,user.id,"UPDATE","product",id,old,x); return j({ok:true});
  }

  if(p==="/api/customers"&&m==="GET"){
    need(user,"customers.read"); const q=s(u.searchParams.get("q")||"",100),like="%"+q+"%",pii=can(user,"customers.pii");
    const sql=pii
      ? `SELECT c.*,COALESCE(SUM(CASE WHEN o.status IN ('confirmed','completed') THEN 1 ELSE 0 END),0) order_count,COALESCE(SUM(CASE WHEN o.status IN ('confirmed','completed') THEN o.total_cents ELSE 0 END),0) lifetime_value_cents
         FROM customers c LEFT JOIN orders o ON o.customer_id=c.id AND o.deleted_at IS NULL WHERE (?='' OR c.name LIKE ? OR c.phone LIKE ?)
         GROUP BY c.id ORDER BY c.updated_at DESC LIMIT 200`
      : `SELECT c.*,COALESCE(SUM(CASE WHEN o.status IN ('confirmed','completed') THEN 1 ELSE 0 END),0) order_count,COALESCE(SUM(CASE WHEN o.status IN ('confirmed','completed') THEN o.total_cents ELSE 0 END),0) lifetime_value_cents
         FROM customers c LEFT JOIN orders o ON o.customer_id=c.id AND o.deleted_at IS NULL WHERE (?='' OR c.name LIKE ?)
         GROUP BY c.id ORDER BY c.updated_at DESC LIMIT 200`;
    const r=pii?await env.DB.prepare(sql).bind(q,like,like).all():await env.DB.prepare(sql).bind(q,like).all();
    let customers=r.results||[]; if(!pii) customers=customers.map(x=>({...x,phone:"",address:"",notes:""}));
    return j({ok:true,customers});
  }
  if(p==="/api/customers"&&m==="POST"){
    need(user,"customers.write"); const x=customer(await body(req)),id=crypto.randomUUID();
    await env.DB.prepare("INSERT INTO customers(id,name,phone,address,notes) VALUES(?,?,?,?,?)").bind(id,x.name,x.phone,x.address,x.notes).run();
    await audit(env,user.id,"CREATE","customer",id,null,{name:x.name,phone:mask(x.phone)}); return j({ok:true,id},201);
  }
  mm=p.match(/^\/api\/customers\/([^/]+)$/);
  if(mm&&m==="PATCH"){
    need(user,"customers.write"); const id=mm[1],old=await env.DB.prepare("SELECT * FROM customers WHERE id=?").bind(id).first(); if(!old)return nf();
    const x=customer({...old,...await body(req)});
    await env.DB.prepare("UPDATE customers SET name=?,phone=?,address=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(x.name,x.phone,x.address,x.notes,id).run();
    await audit(env,user.id,"UPDATE","customer",id,{name:old.name,phone:mask(old.phone)},{name:x.name,phone:mask(x.phone)}); return j({ok:true});
  }

  if(p==="/api/orders"&&m==="GET"){
    need(user,"orders.read");
    const q=s(u.searchParams.get("q")||"",80),from=s(u.searchParams.get("from")||"",10),to=s(u.searchParams.get("to")||"",10),pay=s(u.searchParams.get("payment")||"",20),deliveryFrom=s(u.searchParams.get("delivery_from")||"",10);
    const w=["o.deleted_at IS NULL"],a=[]; if(from){w.push("o.order_date>=?");a.push(from)} if(to){w.push("o.order_date<=?");a.push(to)} if(pay){w.push("o.payment_status=?");a.push(pay)} if(deliveryFrom){w.push("o.delivery_date>=?");a.push(deliveryFrom)}
    if(q){if(can(user,"customers.pii")){w.push("(o.order_no LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)");a.push("%"+q+"%","%"+q+"%","%"+q+"%")}else{w.push("o.order_no LIKE ?");a.push("%"+q+"%")}}
    const pii=can(user,"customers.pii")?",c.name customer_name,c.phone customer_phone,c.address customer_address":"";
    const r=await env.DB.prepare(`SELECT o.* ${pii},GROUP_CONCAT(oi.product_name_snapshot||' ×'||printf('%g',oi.qty),'、') item_summary
      FROM orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN order_items oi ON oi.order_id=o.id
      WHERE ${w.join(" AND ")} GROUP BY o.id ORDER BY o.order_date DESC,o.created_at DESC LIMIT 300`).bind(...a).all();
    let orders=r.results||[];
    if(!can(user,"reports.read")) orders=orders.map(hideOrderFinance);
    return j({ok:true,orders});
  }
  if(p==="/api/orders"&&m==="POST"){need(user,"orders.write");return j(await saveOrder(env,user,await body(req),null),201)}
  mm=p.match(/^\/api\/orders\/([^/]+)$/);
  if(mm&&m==="GET"){
    need(user,"orders.read");
    const pii=can(user,"customers.pii")?",c.name customer_name,c.phone customer_phone,c.address customer_address":"";
    let o=await env.DB.prepare(`SELECT o.* ${pii} FROM orders o LEFT JOIN customers c ON c.id=o.customer_id WHERE o.id=? AND o.deleted_at IS NULL`).bind(mm[1]).first(); if(!o)return nf();
    const items=await env.DB.prepare("SELECT * FROM order_items WHERE order_id=?").bind(mm[1]).all();
    let outItems=items.results||[];
    if(!can(user,"reports.read")){o=hideOrderFinance(o);outItems=outItems.map(x=>{const y={...x};delete y.unit_cost_cents;delete y.line_cost_cents;return y})}
    return j({ok:true,order:o,items:outItems});
  }
  if(mm&&m==="PATCH"){need(user,"orders.write");return j(await saveOrder(env,user,await body(req),mm[1]))}
  if(mm&&m==="DELETE"){
    need(user,"orders.delete");
    const id=mm[1],old=await env.DB.prepare("SELECT * FROM orders WHERE id=? AND deleted_at IS NULL").bind(id).first(); if(!old)return nf();
    const b=await body(req),reason=s(b.reason||"",300);
    const rows=(await env.DB.prepare("SELECT product_id,qty,product_name_snapshot FROM order_items WHERE order_id=?").bind(id).all()).results||[];
    const q=[];
    if(old.status==="confirmed"||old.status==="completed"){
      for(const x of rows){
        if(!x.product_id)continue;
        const p=await env.DB.prepare("SELECT id,track_stock,stock_qty FROM products WHERE id=?").bind(x.product_id).first();
        if(p?.track_stock) q.push(env.DB.prepare("UPDATE products SET stock_qty=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind((+p.stock_qty||0)+(+x.qty||0),p.id));
      }
    }
    q.push(env.DB.prepare("UPDATE orders SET deleted_at=CURRENT_TIMESTAMP,deleted_by=?,delete_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(user.id,reason,id));
    await env.DB.batch(q);
    await audit(env,user.id,"DELETE","order",id,{order_no:old.order_no,total_cents:old.total_cents,status:old.status},{order_no:old.order_no,total_cents:old.total_cents,reason});
    return j({ok:true,message:"訂單已刪除並保留操作紀錄"});
  }

  if(p==="/api/expenses"&&m==="GET"){
    need(user,"expenses.read");
    const from=s(u.searchParams.get("from")||"",10),to=s(u.searchParams.get("to")||"",10),w=["1=1"],a=[];
    if(from){w.push("expense_date>=?");a.push(from)} if(to){w.push("expense_date<=?");a.push(to)}
    const r=await env.DB.prepare(`SELECT * FROM expenses WHERE ${w.join(" AND ")} ORDER BY expense_date DESC,created_at DESC LIMIT 300`).bind(...a).all();
    return j({ok:true,expenses:r.results||[]});
  }
  if(p==="/api/expenses"&&m==="POST"){
    need(user,"expenses.write"); const b=await body(req),id=crypto.randomUUID(),d=s(b.expense_date||dateNow(),10),type=s(b.type||"其他",80),desc=s(b.description,200),amt=Math.max(0,int(b.amount_cents)),notes=s(b.notes||"",1000);
    if(!desc)throw bad("支出說明必填");
    await env.DB.prepare("INSERT INTO expenses(id,expense_date,type,description,amount_cents,notes,created_by) VALUES(?,?,?,?,?,?,?)").bind(id,d,type,desc,amt,notes,user.id).run();
    await audit(env,user.id,"CREATE","expense",id,null,{d,type,desc,amt}); return j({ok:true,id},201);
  }
  mm=p.match(/^\/api\/expenses\/([^/]+)$/);
  if(mm&&m==="PATCH"){
    need(user,"expenses.write"); const id=mm[1],old=await env.DB.prepare("SELECT * FROM expenses WHERE id=?").bind(id).first(); if(!old)return nf();
    const b=await body(req),d=s(b.expense_date??old.expense_date,10),type=s(b.type??old.type,80),desc=s(b.description??old.description,200),amt=Math.max(0,int(b.amount_cents??old.amount_cents)),notes=s(b.notes??old.notes,1000);
    if(!desc)throw bad("支出說明必填");
    await env.DB.prepare("UPDATE expenses SET expense_date=?,type=?,description=?,amount_cents=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(d,type,desc,amt,notes,id).run();
    await audit(env,user.id,"UPDATE","expense",id,old,{expense_date:d,type,description:desc,amount_cents:amt,notes}); return j({ok:true});
  }

  if(p==="/api/investors"&&m==="GET"){
    need(user,"investors.read");
    if(roleOf(user)==="investor"){
      const x=user.investor_id?await env.DB.prepare("SELECT * FROM investors WHERE id=?").bind(user.investor_id).first():null;
      return j({ok:true,investors:x?[x]:[]});
    }
    const r=await env.DB.prepare("SELECT * FROM investors ORDER BY is_active DESC,name").all(); return j({ok:true,investors:r.results||[]});
  }
  if(p==="/api/investors"&&m==="POST"){
    need(user,"investors.write"); const b=await body(req),name=s(b.name,120),pct=+b.percentage||0,id=crypto.randomUUID(),active=b.is_active===0||b.is_active==="0"?0:1; if(!name||pct<0||pct>100)throw bad("名稱或比例不正確");
    if(active){const t=await env.DB.prepare("SELECT COALESCE(SUM(percentage),0) n FROM investors WHERE is_active=1").first(); if((+t.n||0)+pct>100.0001)throw bad("啟用中的投資比例不可超過 100%")}
    await env.DB.prepare("INSERT INTO investors(id,name,percentage,is_active,notes) VALUES(?,?,?,?,?)").bind(id,name,pct,active,s(b.notes||"",1000)).run();
    await audit(env,user.id,"CREATE","investor",id,null,{name,pct,is_active:active}); return j({ok:true,id},201);
  }
  mm=p.match(/^\/api\/investors\/([^/]+)$/);
  if(mm&&m==="PATCH"){
    need(user,"investors.write"); const id=mm[1],old=await env.DB.prepare("SELECT * FROM investors WHERE id=?").bind(id).first(); if(!old)return nf();
    const b=await body(req),name=s(b.name??old.name,120),pct=Number(b.percentage??old.percentage),active=b.is_active==null?(+old.is_active||0):(b.is_active===0||b.is_active==="0"?0:1),notes=s(b.notes??old.notes,1000);
    if(!name||!Number.isFinite(pct)||pct<0||pct>100)throw bad("名稱或比例不正確");
    if(active){const t=await env.DB.prepare("SELECT COALESCE(SUM(percentage),0) n FROM investors WHERE is_active=1 AND id<>?").bind(id).first();if((+t.n||0)+pct>100.0001)throw bad("啟用中的投資比例不可超過 100%")}
    await env.DB.prepare("UPDATE investors SET name=?,percentage=?,is_active=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(name,pct,active,notes,id).run();
    await audit(env,user.id,"UPDATE","investor",id,old,{name,percentage:pct,is_active:active,notes}); return j({ok:true});
  }

  if(p==="/api/users"&&m==="GET"){
    need(user,"accounts.manage"); const r=await env.DB.prepare(`SELECT u.id,u.name,u.email,u.role,u.access_role,u.permissions_json,u.account_status,u.investor_id,u.is_active,u.requested_at,u.reviewed_at,u.created_at,i.name investor_name
      FROM users u LEFT JOIN investors i ON i.id=u.investor_id ORDER BY CASE u.account_status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,u.created_at DESC`).all();
    const users=(r.results||[]).map(x=>({...x,permissions:parsePerms(x.permissions_json)})); return j({ok:true,users});
  }
  if(p==="/api/users"&&m==="POST"){
    need(user,"accounts.manage"); const b=await body(req),name=s(b.name,80),email=s(b.email,180).toLowerCase(),pw=String(b.password||""),access=validRole(b.access_role||b.role),legacy=access==="admin"?"admin":"investor",iid=access==="investor"&&b.investor_id?s(b.investor_id,80):null,perms=normalizePerms(b.permissions,access);
    if(!name||!email.includes("@")||pw.length<10)throw bad("名稱、Email 必填；密碼至少 10 個字元");
    const ph=await pass(pw),id=crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO users(id,name,email,password_hash,password_salt,role,investor_id,is_active,account_status,access_role,permissions_json,requested_at,reviewed_at,reviewed_by)
      VALUES(?,?,?,?,?,?,?,1,'active',?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?)`).bind(id,name,email,ph.hash,ph.salt,legacy,iid,JSON.stringify(perms),access,user.id).run();
    await audit(env,user.id,"CREATE","user",id,null,{name,email,access_role:access,permissions:perms}); return j({ok:true,id},201);
  }
  mm=p.match(/^\/api\/users\/([^/]+)$/);
  if(mm&&m==="PATCH"){
    need(user,"accounts.manage"); const id=mm[1],old=await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(id).first(); if(!old)return nf();
    const b=await body(req),access=validRole(b.access_role||old.access_role||old.role),status=["pending","active","rejected"].includes(b.account_status)?b.account_status:(old.account_status||"active");
    if(id===user.id&&(status!=="active"||access!=="admin")) throw bad("不可停用或降級目前登入中的管理員帳戶");
    const name=s(b.name??old.name,80),email=s(b.email??old.email,180).toLowerCase(),newPassword=String(b.password||"");
    if(!name||!email.includes("@")) throw bad("名稱及 Email 必填");
    if(newPassword&&newPassword.length<10) throw bad("新密碼至少 10 個字元");
    const dup=await env.DB.prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE AND id<>? LIMIT 1").bind(email,id).first();
    if(dup) throw bad("這個 Email 已被其他帳戶使用",409);
    const perms=normalizePerms(Array.isArray(b.permissions)?b.permissions:parsePerms(old.permissions_json),access),legacy=access==="admin"?"admin":"investor",iid=access==="investor"&&b.investor_id?s(b.investor_id,80):null,active=status==="active"?(b.is_active===0?0:1):0;
    const ph=newPassword?await pass(newPassword):null;
    if(ph){
      await env.DB.prepare(`UPDATE users SET name=?,email=?,password_hash=?,password_salt=?,role=?,access_role=?,permissions_json=?,account_status=?,investor_id=?,is_active=?,reviewed_at=CURRENT_TIMESTAMP,reviewed_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .bind(name,email,ph.hash,ph.salt,legacy,access,JSON.stringify(perms),status,iid,active,user.id,id).run();
    }else{
      await env.DB.prepare(`UPDATE users SET name=?,email=?,role=?,access_role=?,permissions_json=?,account_status=?,investor_id=?,is_active=?,reviewed_at=CURRENT_TIMESTAMP,reviewed_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .bind(name,email,legacy,access,JSON.stringify(perms),status,iid,active,user.id,id).run();
    }
    if(id!==user.id) await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(id).run();
    else if(!active) await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(id).run();
    await audit(env,user.id,"REVIEW","user",id,{name:old.name,email:old.email,account_status:old.account_status,access_role:old.access_role},{name,email,account_status:status,access_role:access,permissions:perms,password_reset:!!newPassword});
    return j({ok:true});
  }

  if(p==="/api/settings"&&m==="GET"){
    need(user,"settings.read"); const x=await settings(env); return j({ok:true,settings:x});
  }
  if(p==="/api/settings"&&m==="PATCH"){
    need(user,"settings.write"); const b=await body(req),allow=["business_name","currency","order_prefix","default_delivery_cost_cents","customer_delivery_fee_cents","free_shipping_threshold_cents","free_shipping_basis"],q=[];
    for(const k of allow) if(k in b) q.push(env.DB.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(k,String(b[k])));
    if(q.length)await env.DB.batch(q); await audit(env,user.id,"UPDATE","settings","global",null,b); return j({ok:true});
  }

  if(p==="/api/audit"){
    need(user,"audit.read"); const r=await env.DB.prepare(`SELECT a.*,u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 300`).all();
    return j({ok:true,logs:r.results||[]});
  }

  if(p==="/api/reports/summary"){
    need(user,"reports.read");
    const from=s(u.searchParams.get("from")||dateNow().slice(0,7)+"-01",10),to=s(u.searchParams.get("to")||dateNow(),10);
    const [o,e,byday,byp]=await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) order_count,COALESCE(SUM(total_cents),0) revenue_cents,COALESCE(SUM(product_cost_cents),0) product_cost_cents,
        COALESCE(SUM(net_profit_cents),0) order_profit_cents,COALESCE(SUM(paid_amount_cents),0) paid_cents,
        COALESCE(SUM(CASE WHEN total_cents>paid_amount_cents THEN total_cents-paid_amount_cents ELSE 0 END),0) outstanding_cents
        FROM orders WHERE deleted_at IS NULL AND order_date BETWEEN ? AND ? AND status IN ('confirmed','completed')`).bind(from,to).first(),
      env.DB.prepare("SELECT COALESCE(SUM(amount_cents),0) expense_cents FROM expenses WHERE expense_date BETWEEN ? AND ?").bind(from,to).first(),
      env.DB.prepare(`SELECT order_date date,COUNT(*) orders,SUM(total_cents) revenue_cents,SUM(net_profit_cents) order_profit_cents FROM orders
        WHERE deleted_at IS NULL AND order_date BETWEEN ? AND ? AND status IN ('confirmed','completed') GROUP BY order_date ORDER BY order_date`).bind(from,to).all(),
      env.DB.prepare(`SELECT oi.product_name_snapshot name,SUM(oi.qty) qty,SUM(oi.line_total_cents) sales_cents,SUM(oi.line_cost_cents) cost_cents
        FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.deleted_at IS NULL AND o.order_date BETWEEN ? AND ? AND o.status IN ('confirmed','completed')
        GROUP BY oi.product_name_snapshot ORDER BY sales_cents DESC`).bind(from,to).all()
    ]);
    const sum={...nums(o),expense_cents:+e.expense_cents||0};sum.net_profit_cents=sum.order_profit_cents-sum.expense_cents;
    if(roleOf(user)==="investor"){sum.investor_percentage=+user.investor_percentage||0;sum.investor_share_cents=Math.round(sum.net_profit_cents*sum.investor_percentage/100)}
    return j({ok:true,from,to,summary:sum,by_day:byday.results||[],by_product:byp.results||[]});
  }

  if(p==="/api/export/orders.csv"){
    need(user,"export.orders"); const r=await env.DB.prepare(`SELECT o.order_no,o.order_date,c.name customer,c.phone,c.address,o.total_cents,o.paid_amount_cents,o.net_profit_cents,o.payment_status,o.delivery_date,o.delivery_status
      FROM orders o LEFT JOIN customers c ON c.id=o.customer_id WHERE o.deleted_at IS NULL ORDER BY o.order_date DESC`).all();
    const rows=[["訂單","日期","客戶","電話","地址","總額","實收","淨利","付款","送貨日","送貨狀態"],...(r.results||[]).map(x=>[x.order_no,x.order_date,x.customer,x.phone,x.address,money(x.total_cents),money(x.paid_amount_cents),money(x.net_profit_cents),x.payment_status,x.delivery_date,x.delivery_status])];
    return new Response("\uFEFF"+rows.map(r=>r.map(csv).join(",")).join("\n"),{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":"attachment; filename=crab-pos-orders.csv"}});
  }

  return nf();
}

async function createFirstAdmin(env,b){
  const name=s(b.name,80),email=s(b.email,180).toLowerCase(),pw=String(b.password||"");
  if(!name||!email.includes("@")||pw.length<10)throw bad("請輸入名稱、Email，密碼至少 10 個字元");
  const ph=await pass(pw),id=crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO users(id,name,email,password_hash,password_salt,role,is_active,account_status,access_role,permissions_json,requested_at,reviewed_at)
    VALUES(?,?,?,?,?,'admin',1,'active','admin','["*"]',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).bind(id,name,email,ph.hash,ph.salt).run();
  return sessionResponse(env,id,{ok:true,user:{id,name,email,role:"admin",access_role:"admin",permissions:["*"],account_status:"active"}});
}

async function saveOrder(env,user,b,id){
  const old=id?await env.DB.prepare("SELECT * FROM orders WHERE id=? AND deleted_at IS NULL").bind(id).first():null;
  if(id&&!old)throw bad("找不到訂單",404);
  const oldItemsRes=id?await env.DB.prepare("SELECT * FROM order_items WHERE order_id=?").bind(id).all():{results:[]};
  const oldRows=oldItemsRes.results||[];
  const customerWrites=[];

  let cid=b.customer_id||old?.customer_id||null;
  if(b.customer){
    const incoming={
      name:s(b.customer.name||"散客",120),
      phone:s(b.customer.phone||"",50),
      address:s(b.customer.address||"",400),
      notes:b.customer.notes==null?null:s(b.customer.notes,1000)
    };
    let current=cid?await env.DB.prepare("SELECT * FROM customers WHERE id=?").bind(cid).first():null;
    if(current&&incoming.phone&&current.phone&&incoming.phone!==current.phone){
      const match=await env.DB.prepare("SELECT * FROM customers WHERE phone=? AND phone<>'' ORDER BY updated_at DESC LIMIT 1").bind(incoming.phone).first();
      current=match||null; cid=match?.id||null;
    }else if(!current&&incoming.phone){
      const match=await env.DB.prepare("SELECT * FROM customers WHERE phone=? AND phone<>'' ORDER BY updated_at DESC LIMIT 1").bind(incoming.phone).first();
      current=match||null; cid=match?.id||null;
    }
    const isWalkIn=!incoming.phone&&!incoming.address&&(incoming.name==="散客"||!incoming.name);
    if(!isWalkIn){
      if(current){
        const x={
          name:incoming.name||current.name||"散客",
          phone:incoming.phone||current.phone||"",
          address:incoming.address||current.address||"",
          notes:incoming.notes==null?(current.notes||""):incoming.notes
        };
        customerWrites.push(env.DB.prepare("UPDATE customers SET name=?,phone=?,address=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(x.name,x.phone,x.address,x.notes,current.id));
        cid=current.id;
      }else{
        cid=crypto.randomUUID();
        customerWrites.push(env.DB.prepare("INSERT INTO customers(id,name,phone,address,notes) VALUES(?,?,?,?,?)").bind(cid,incoming.name||"散客",incoming.phone,incoming.address,incoming.notes||""));
      }
    }else cid=null;
  }

  const oldCost=new Map();
  for(const x of oldRows) if(x.product_id&&!oldCost.has(x.product_id)) oldCost.set(x.product_id,+x.unit_cost_cents||0);

  let items=[];
  if(Array.isArray(b.items)){
    if(!b.items.length)throw bad("至少要有一項產品");
    for(const x of b.items){
      const p=await env.DB.prepare("SELECT * FROM products WHERE id=?").bind(x.product_id).first();
      if(!p)throw bad("找不到產品");
      const qty=+x.qty||0;
      if(qty<=0)throw bad("數量不正確");
      const price=x.unit_price_cents==null?Math.max(0,+p.sale_price_cents||0):Math.max(0,int(x.unit_price_cents));
      const cost=id&&oldCost.has(p.id)?oldCost.get(p.id):(+p.cost_cents||0);
      items.push({id:crypto.randomUUID(),product_id:p.id,name:p.name,unit:p.unit,qty,price,cost,total:Math.round(qty*price),linecost:Math.round(qty*cost)});
    }
  }else if(id){
    items=oldRows.map(x=>({id:x.id,product_id:x.product_id,name:x.product_name_snapshot,unit:x.unit_snapshot,qty:+x.qty,price:+x.unit_price_cents,cost:+x.unit_cost_cents,total:+x.line_total_cents,linecost:+x.line_cost_cents}));
  }

  const subtotal=items.reduce((a,x)=>a+x.total,0),pcost=items.reduce((a,x)=>a+x.linecost,0),st=await settings(env);
  const discountPct=Number(b.discount_percent);
  const disc=Number.isFinite(discountPct)&&discountPct>=0&&discountPct<=100
    ?Math.min(subtotal,Math.round(subtotal*discountPct/100))
    :Math.min(subtotal,Math.max(0,int(b.discount_cents??old?.discount_cents)));
  const discountedSubtotal=Math.max(0,subtotal-disc);
  const standardDeliveryFee=Math.max(0,int(st.customer_delivery_fee_cents||0));
  const freeThreshold=Math.max(0,int(st.free_shipping_threshold_cents||0));
  const freeBasis=st.free_shipping_basis==="subtotal"?"subtotal":"discounted";
  const freeBasisValue=freeBasis==="subtotal"?subtotal:discountedSubtotal;
  const shippingMode=["auto","free","custom"].includes(b.shipping_mode)?b.shipping_mode:null;
  let df;
  if(shippingMode==="auto") df=freeThreshold>0&&freeBasisValue>=freeThreshold?0:standardDeliveryFee;
  else if(shippingMode==="free") df=0;
  else if(shippingMode==="custom") df=Math.max(0,int(b.delivery_fee_cents));
  else df=Math.max(0,int(b.delivery_fee_cents??old?.delivery_fee_cents));
  const of=Math.max(0,int(b.other_fee_cents??old?.other_fee_cents));
  const finance=can(user,"reports.read")||can(user,"products.write");
  const defaultDc=Math.max(0,int(st.default_delivery_cost_cents||0));
  const dc=finance?Math.max(0,int(b.delivery_cost_cents??old?.delivery_cost_cents??defaultDc)):Math.max(0,int(old?.delivery_cost_cents??defaultDc));
  const oc=finance?Math.max(0,int(b.other_cost_cents??old?.other_cost_cents)):Math.max(0,int(old?.other_cost_cents??0));
  const total=Math.max(0,discountedSubtotal+df+of),paid=Math.max(0,int(b.paid_amount_cents??old?.paid_amount_cents)),tcost=pcost+dc+oc,net=total-tcost,pay=paid<=0?"unpaid":paid>=total?"paid":"partial";
  const od=s(b.order_date||old?.order_date||dateNow(),10),no=s(b.order_no||old?.order_no||await orderNo(env,od),50);
  const ds=["待安排","已安排","配送中","已完成","取消"].includes(b.delivery_status)?b.delivery_status:(old?.delivery_status||"待安排");
  const status=["draft","confirmed","completed","cancelled"].includes(b.status)?b.status:(old?.status||"confirmed");

  const dup=await env.DB.prepare("SELECT id FROM orders WHERE order_no=? AND id<>? LIMIT 1").bind(no,id||"").first();
  if(dup)throw bad("訂單編號已存在，請使用另一個編號");

  const q=[...customerWrites];
  const orderId=id||crypto.randomUUID();
  if(id)q.push(env.DB.prepare(`UPDATE orders SET order_no=?,customer_id=?,order_date=?,delivery_date=?,delivery_slot=?,delivery_person=?,delivery_status=?,status=?,payment_status=?,payment_method=?,subtotal_cents=?,discount_cents=?,delivery_fee_cents=?,other_fee_cents=?,total_cents=?,paid_amount_cents=?,product_cost_cents=?,delivery_cost_cents=?,other_cost_cents=?,total_cost_cents=?,gross_profit_cents=?,net_profit_cents=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(no,cid,od,s(b.delivery_date??old.delivery_date,10),s(b.delivery_slot??old.delivery_slot,80),s(b.delivery_person??old.delivery_person,80),ds,status,pay,s(b.payment_method??old.payment_method,50),subtotal,disc,df,of,total,paid,pcost,dc,oc,tcost,subtotal-disc-pcost,net,s(b.notes??old.notes,1000),id));
  else q.push(env.DB.prepare(`INSERT INTO orders(id,order_no,customer_id,order_date,delivery_date,delivery_slot,delivery_person,delivery_status,status,payment_status,payment_method,subtotal_cents,discount_cents,delivery_fee_cents,other_fee_cents,total_cents,paid_amount_cents,product_cost_cents,delivery_cost_cents,other_cost_cents,total_cost_cents,gross_profit_cents,net_profit_cents,notes,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(orderId,no,cid,od,s(b.delivery_date||"",10),s(b.delivery_slot||"",80),s(b.delivery_person||"",80),ds,status,pay,s(b.payment_method||"",50),subtotal,disc,df,of,total,paid,pcost,dc,oc,tcost,subtotal-disc-pcost,net,s(b.notes||"",1000),user.id));

  if(Array.isArray(b.items)){
    q.push(env.DB.prepare("DELETE FROM order_items WHERE order_id=?").bind(orderId));
    for(const x of items) q.push(env.DB.prepare("INSERT INTO order_items(id,order_id,product_id,product_name_snapshot,unit_snapshot,qty,unit_price_cents,unit_cost_cents,line_total_cents,line_cost_cents) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(x.id,orderId,x.product_id,x.name,x.unit,x.qty,x.price,x.cost,x.total,x.linecost));
  }

  const impacts=s=>s==="confirmed"||s==="completed";
  const oldMap=new Map(),newMap=new Map();
  if(old&&impacts(old.status)) for(const x of oldRows) if(x.product_id) oldMap.set(x.product_id,(oldMap.get(x.product_id)||0)+(+x.qty||0));
  if(impacts(status)) for(const x of items) if(x.product_id) newMap.set(x.product_id,(newMap.get(x.product_id)||0)+(+x.qty||0));
  const affected=new Set([...oldMap.keys(),...newMap.keys()]);
  for(const pid of affected){
    const delta=(oldMap.get(pid)||0)-(newMap.get(pid)||0);
    if(Math.abs(delta)<1e-9)continue;
    const p=await env.DB.prepare("SELECT id,name,track_stock,stock_qty FROM products WHERE id=?").bind(pid).first();
    if(!p||!p.track_stock)continue;
    const next=(+p.stock_qty||0)+delta;
    if(next< -1e-9)throw bad(`「${p.name}」庫存不足，目前 ${(+p.stock_qty||0)}，此操作需要再扣 ${Math.abs(delta)}`);
    q.push(env.DB.prepare("UPDATE products SET stock_qty=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(Math.max(0,next),pid));
  }

  await env.DB.batch(q);
  await audit(env,user.id,old?"UPDATE":"CREATE","order",orderId,old?{order_no:old.order_no,total_cents:old.total_cents,status:old.status}:null,{order_no:no,total_cents:total,status,net_profit_cents:net});
  const out={ok:true,id:orderId,order_no:no,total_cents:total,payment_status:pay};
  if(can(user,"reports.read"))out.net_profit_cents=net;
  return out;
}

async function currentUser(req,env){const t=cookie(req,COOKIE);if(!t)return null;return await env.DB.prepare(`SELECT u.id,u.name,u.email,u.role,u.access_role,u.permissions_json,u.account_status,u.investor_id,u.is_active,i.name investor_name,i.percentage investor_percentage
  FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN investors i ON i.id=u.investor_id WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP AND u.is_active=1 AND u.account_status='active' LIMIT 1`).bind(await sha(t)).first()}
async function sessionResponse(env,uid,payload){const t=token(),exp=new Date(Date.now()+DAYS*864e5).toISOString();await env.DB.batch([env.DB.prepare("DELETE FROM sessions WHERE expires_at<=CURRENT_TIMESTAMP"),env.DB.prepare("INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES(?,?,?,?)").bind(crypto.randomUUID(),uid,await sha(t),exp)]);return j(payload,200,{"Set-Cookie":`${COOKIE}=${t}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${DAYS*86400}`})}
function clearCookie(){return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`}
function cookie(req,n){for(const p of (req.headers.get("cookie")||"").split(";")){const [k,...v]=p.trim().split("=");if(k===n)return v.join("=")}return""}
async function pass(p){const salt=crypto.getRandomValues(new Uint8Array(16)),hash=await derive(p,salt);return{salt:b64(salt),hash}}
async function verify(p,salt,h){try{return await derive(p,fromb64(salt))===h}catch{return false}}
async function derive(p,salt){const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(p),"PBKDF2",false,["deriveBits"]);return b64(new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt,iterations:ITER},k,256)))}
async function sha(x){const a=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(x)));return [...a].map(b=>b.toString(16).padStart(2,"0")).join("")}
function token(){return b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g,"")}
function b64(a){let s="";for(const b of a)s+=String.fromCharCode(b);return btoa(s)}function fromb64(s){const x=atob(s),a=new Uint8Array(x.length);for(let i=0;i<x.length;i++)a[i]=x.charCodeAt(i);return a}
async function settings(env){const r=await env.DB.prepare("SELECT key,value FROM settings").all();return Object.fromEntries((r.results||[]).map(x=>[x.key,x.value]))}
async function audit(env,uid,act,type,id,before,after){try{await env.DB.prepare("INSERT INTO audit_logs(id,user_id,action,entity_type,entity_id,before_json,after_json) VALUES(?,?,?,?,?,?,?)").bind(crypto.randomUUID(),uid,act,type,id||"",before?JSON.stringify(before):null,after?JSON.stringify(after):null).run()}catch{}}
async function orderNo(env,d){const x=await settings(env),pre=(x.order_prefix||"CRAB").replace(/[^A-Z0-9_-]/gi,"")||"CRAB";return `${pre}-${d.replace(/-/g,"")}-${Math.floor(Math.random()*1000000).toString().padStart(6,"0")}`}
function product(b){const name=s(b.name,120);if(!name)throw bad("產品名稱必填");return{name,sku:s(b.sku||"",50),category:s(b.category||"其他",80),unit:s(b.unit||"隻",20),cost_cents:Math.max(0,int(b.cost_cents)),sale_price_cents:Math.max(0,int(b.sale_price_cents)),track_stock:bool(b.track_stock),stock_qty:Math.max(0,+b.stock_qty||0),is_active:b.is_active===0||b.is_active==="0"?0:1}}
function customer(b){const name=s(b.name||"散客",120);return{name,phone:s(b.phone||"",50),address:s(b.address||"",400),notes:s(b.notes||"",1000)}}
function parsePerms(v){if(Array.isArray(v))return v;try{const x=JSON.parse(v||"[]");return Array.isArray(x)?x:[]}catch{return[]}}
function roleOf(u){return u.access_role||u.role||"viewer"}
function validRole(v){return ["admin","staff","investor","viewer","customer"].includes(v)?v:"viewer"}
function normalizePerms(v,role){if(role==="admin")return["*"];const a=Array.isArray(v)?v:ROLE_PERMISSIONS[role]||[];return [...new Set(a.filter(x=>KNOWN_PERMISSIONS.includes(x)))]}
function can(u,p){const r=roleOf(u);if(r==="admin")return true;const a=parsePerms(u.permissions_json||u.permissions);if(a.includes("*")||a.includes(p))return true;return a.some(x=>(PERM_GRANTS[x]||[]).includes(p))}
function need(u,p){if(!can(u,p))throw bad("沒有權限",403)}
function hideOrderFinance(x){const y={...x};for(const k of ["product_cost_cents","delivery_cost_cents","other_cost_cents","total_cost_cents","gross_profit_cents","net_profit_cents"])delete y[k];return y}
function safeUser(u){return{id:u.id,name:u.name,email:u.email,role:u.role,access_role:roleOf(u),permissions:parsePerms(u.permissions_json||u.permissions),account_status:u.account_status||"active",investor_id:u.investor_id||null,investor_name:u.investor_name||null,investor_percentage:+u.investor_percentage||0}}
function admin(u){if(roleOf(u)!=="admin")throw bad("沒有權限",403)}function bad(msg,status=400){const e=new Error(msg);e.status=status;return e}function nf(){return j({ok:false,message:"找不到資料"},404)}
function s(v,n=500){return String(v??"").trim().replace(/\0/g,"").slice(0,n)}function int(v){const n=Number(v);return Number.isFinite(n)?Math.round(n):0}function bool(v){return v===1||v==="1"||v===true?1:0}function nums(o){const x={};for(const[k,v]of Object.entries(o||{}))x[k]=/(_cents|count)$/.test(k)?+v||0:v;return x}
function dateNow(){return new Date().toISOString().slice(0,10)}function money(c){return((+c||0)/100).toFixed(2)}function mask(x){x=String(x||"");return x.length<5?"***":x.slice(0,2)+"***"+x.slice(-2)}function csv(v){let x=String(v??"");if(/^[=+\-@]/.test(x))x="'"+x;return '"'+x.replace(/"/g,'""')+'"'}
async function body(req){try{return await req.json()}catch{return{}}}
function j(x,status=200,h={}){return new Response(JSON.stringify(x),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...h}})}
function cors(res,req,env){const origin=req.headers.get("origin"),allow=env.ALLOWED_ORIGIN||"";if(origin&&allow&&(origin===allow||allow==="*")){res.headers.set("Access-Control-Allow-Origin",origin);res.headers.set("Access-Control-Allow-Credentials","true");res.headers.set("Access-Control-Allow-Headers","content-type");res.headers.set("Access-Control-Allow-Methods","GET,POST,PATCH,DELETE,OPTIONS");res.headers.set("Vary","Origin")}return res}
