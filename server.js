require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const Razorpay = require('razorpay');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });
const PORT = process.env.PORT || 3000;
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not configured. Add the Render PostgreSQL connection string in Environment Variables.');
  process.exit(1);
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000
});
const razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID || '', key_secret: process.env.RAZORPAY_KEY_SECRET || '' });

// Razorpay webhook. QR payments do not carry a Razorpay order_id, so we also
// resolve them by qr_code_id before fulfilling the matching store order.
app.post('/api/payment/webhook', express.raw({type:'application/json'}), async (req,res)=>{
  try{
    const signature=req.headers['x-razorpay-signature'];
    const secret=process.env.RAZORPAY_WEBHOOK_SECRET || '';
    if(!signature || !secret || !Buffer.isBuffer(req.body)) return res.status(400).send('invalid webhook');
    const expected=crypto.createHmac('sha256',secret).update(req.body).digest('hex');
    const a=Buffer.from(expected,'utf8'), b=Buffer.from(String(signature),'utf8');
    if(a.length!==b.length || !crypto.timingSafeEqual(a,b)) return res.status(400).send('invalid signature');
    const payload=JSON.parse(req.body.toString('utf8'));
    if(payload.event==='payment.captured' || payload.event==='order.paid'){
      const entity=payload.payload?.payment?.entity;
      const paymentId=entity?.id;
      const qrCodeId=entity?.qr_code_id;
      let orderId=entity?.order_id || payload.payload?.order?.entity?.id;
      if(!orderId && qrCodeId){
        const r=await q('SELECT order_id FROM orders WHERE qr_code_id=$1 LIMIT 1',[qrCodeId]);
        orderId=r.rows[0]?.order_id;
      }
      if(orderId && paymentId){
        const ord=await q('SELECT qr_code_id FROM orders WHERE order_id=$1',[orderId]);
        if(ord.rows[0]?.qr_code_id) await recordQrPayment(orderId,paymentId,qrCodeId);
        else await recordPayment(orderId,paymentId);
      }
    }
    res.send('ok');
  }catch(e){ console.error('Webhook error:',e); res.status(500).send('retry'); }
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Serve the storefront explicitly at the root URL.
app.get('/', (req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

app.get('/health', (req,res)=>res.json({ok:true,service:'nishad-brand-store'}));

function auth(req,res,next){
  try {
    const token = req.cookies.nishad_admin;
    if(!token) return res.status(401).json({error:'Unauthorized'});
    req.admin = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch { res.status(401).json({error:'Unauthorized'}); }
}
function money(n){ return Math.round(Number(n)*100); }
function signToken(){ return jwt.sign({role:'admin'}, process.env.JWT_SECRET, {expiresIn:'7d'}); }
async function q(text, params=[]){ return pool.query(text, params); }
async function setting(key){ const r=await q('SELECT value FROM settings WHERE key=$1',[key]); return r.rows[0]?.value || ''; }
async function settings(){ const r=await q('SELECT key,value FROM settings'); return Object.fromEntries(r.rows.map(x=>[x.key,x.value])); }
function publicSettings(s, stock=0){
  const basePrice = Number(s.price_per_id ?? s.package_1 ?? 0);
  const packages = [1,2,5,10,15,20].map(qty=>({
    qty,
    price: Math.round(basePrice * qty * 100) / 100,
    available: stock >= qty
  }));
  return {siteName:s.site_name||'NISHAD BRAND', whatsapp:s.whatsapp_number||'', logo:s.logo_data||'/logo.png', qr:s.qr_data||'/payment-qr.png', news:s.news||'', pricePerId:basePrice, packages, stock};
}

app.get('/api/config', async (req,res)=>{
  try {
    const s=await settings();
    const stock=await q("SELECT COUNT(*)::int AS count FROM inventory WHERE status='available'");
    res.json(publicSettings(s, stock.rows[0].count));
  } catch(e){ console.error('Config error:',e); res.status(500).json({error:'Server error'}); }
});

app.post('/api/admin/login', async (req,res)=>{
  const {username,password}=req.body||{};
  const okUser=username===process.env.ADMIN_USERNAME;
  const configured=process.env.ADMIN_PASSWORD||'';
  const okPass=configured.startsWith('$2') ? await bcrypt.compare(password||'',configured) : password===configured;
  if(!okUser || !okPass) return res.status(401).json({error:'Invalid login'});
  res.cookie('nishad_admin',signToken(),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:7*24*3600*1000});
  res.json({ok:true});
});
app.post('/api/admin/logout',(req,res)=>{res.clearCookie('nishad_admin');res.json({ok:true});});
app.get('/api/admin/me',auth,(req,res)=>res.json({ok:true}));

app.get('/api/admin/dashboard',auth,async(req,res)=>{
  const s=await settings();
  const stock=await q("SELECT COUNT(*)::int AS count FROM inventory WHERE status='available'");
  const sold=await q("SELECT COUNT(*)::int AS count FROM inventory WHERE status='sold'");
  const orders=await q("SELECT order_id,package_qty,amount_paise,status,payment_id,utr,customer_name,customer_phone,created_at,fulfilled_at FROM orders ORDER BY created_at DESC LIMIT 100");
  const inv=await q("SELECT id,login_id,login_password,extra_data,status,sold_order_id,created_at FROM inventory ORDER BY id DESC LIMIT 500");
  res.json({settings:s,stock:stock.rows[0].count,sold:sold.rows[0].count,orders:orders.rows,inventory:inv.rows});
});

app.post('/api/admin/settings',auth,async(req,res)=>{
  const allowed=['site_name','whatsapp_number','price_per_id','news'];
  for(const key of allowed){ if(req.body[key]!==undefined) await q('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',[key,String(req.body[key])]); }
  res.json({ok:true});
});
app.post('/api/admin/orders/:orderId/approve',auth,async(req,res)=>{
  try{
    const ord=await q("SELECT * FROM orders WHERE order_id=$1",[req.params.orderId]);
    if(!ord.rows[0]) return res.status(404).json({error:'Order not found'});
    if(ord.rows[0].status==='approved' || ord.rows[0].status==='paid') return res.json({ok:true,already:true});
    if(ord.rows[0].status!=='payment_received') return res.status(400).json({error:'UTR has not been submitted yet'});
    if(!ord.rows[0].utr) return res.status(400).json({error:'UTR is required before approval'});
    await fulfillManual(req.params.orderId);
    res.json({ok:true});
  }catch(e){console.error('Approve error:',e);res.status(500).json({error:e.message||'Could not approve order'});}
});
app.post('/api/admin/orders/:orderId/reject',auth,async(req,res)=>{
  try{
    const r=await q("UPDATE orders SET status='rejected' WHERE order_id=$1 AND status='payment_received' RETURNING order_id",[req.params.orderId]);
    if(!r.rows[0]) return res.status(400).json({error:'Only pending payment orders can be rejected'});
    res.json({ok:true});
  }catch(e){res.status(500).json({error:'Could not reject order'});}
});

app.post('/api/admin/assets',auth,upload.fields([{name:'logo',maxCount:1},{name:'qr',maxCount:1}]),async(req,res)=>{
  for(const key of ['logo','qr']){
    const file=req.files?.[key]?.[0];
    if(file){ const data=`data:${file.mimetype};base64,${file.buffer.toString('base64')}`; await q('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',[key==='logo'?'logo_data':'qr_data',data]); }
  }
  res.json({ok:true});
});
app.post('/api/admin/inventory',auth,async(req,res)=>{
  const rows=Array.isArray(req.body.items)?req.body.items:[];
  if(!rows.length) return res.status(400).json({error:'No IDs provided'});
  const client=await pool.connect();
  try{ await client.query('BEGIN'); for(const item of rows){ if(!item.login_id) continue; await client.query('INSERT INTO inventory(login_id,login_password,extra_data) VALUES($1,$2,$3)',[item.login_id,item.login_password||null,item.extra_data||null]); } await client.query('COMMIT'); res.json({ok:true}); }
  catch(e){await client.query('ROLLBACK');res.status(500).json({error:'Could not add inventory'});} finally{client.release();}
});
app.delete('/api/admin/inventory/:id',auth,async(req,res)=>{ await q("DELETE FROM inventory WHERE id=$1 AND status='available'",[req.params.id]); res.json({ok:true}); });

async function razorpayApi(pathname, options={}){
  const keyId=process.env.RAZORPAY_KEY_ID || '';
  const keySecret=process.env.RAZORPAY_KEY_SECRET || '';
  if(!keyId || !keySecret) throw new Error('Payment gateway is not configured yet');
  const auth=Buffer.from(keyId+':'+keySecret).toString('base64');
  const response=await fetch('https://api.razorpay.com/v1'+pathname,{
    ...options,
    headers:{'Authorization':'Basic '+auth,'Content-Type':'application/json',...(options.headers||{})}
  });
  const text=await response.text();
  let data={}; try{ data=text?JSON.parse(text):{}; }catch{ data={error:{description:text}}; }
  if(!response.ok){
    const msg=data?.error?.description || data?.error?.code || 'Razorpay API request failed';
    throw new Error(msg);
  }
  return data;
}

async function createOrder(req,res){
  const qty=Number(req.body.qty), name=(req.body.name||'').trim(), phone=(req.body.phone||'').trim();
  if(!Number.isInteger(qty) || qty < 1 || qty > 1000) return res.status(400).json({error:'Quantity must be between 1 and 1000'});
  const basePrice=Number(await setting('price_per_id') || await setting('package_1'));
  const price=Math.round(basePrice * qty * 100) / 100;
  if(!price) return res.status(400).json({error:'Package not configured'});
  const count=await q("SELECT COUNT(*)::int AS count FROM inventory WHERE status='available'");
  if(count.rows[0].count<qty) return res.status(409).json({error:'Not enough stock'});
  try{
    // Manual UPI flow: no Razorpay Checkout and no gateway redirect.
    // The customer scans the admin-provided static QR and then submits the UTR.
    const orderId='NB'+Date.now()+Math.floor(Math.random()*100000);
    const qrImage=(await setting('qr_data')) || '/payment-qr.png';
    await q('INSERT INTO orders(order_id,package_qty,amount_paise,status,customer_name,customer_phone) VALUES($1,$2,$3,$4,$5,$6)',[orderId,qty,money(price),'created',name,phone]);
    res.json({orderId,qrImage,amount:money(price),currency:'INR',expiresAt:Date.now()+300000});
  }catch(e){console.error('Manual order create error:',e);res.status(500).json({error:e.message || 'Could not create order'});}
}
app.post('/api/orders',createOrder);

async function recordQrPayment(orderId,paymentId,qrCodeId){
  const ord=await q('SELECT * FROM orders WHERE order_id=$1',[orderId]);
  if(!ord.rows[0] || ord.rows[0].status==='approved' || ord.rows[0].status==='paid') return;
  const payment=await razorpay.payments.fetch(paymentId);
  if(!payment) throw new Error('Payment not found');
  if(payment.currency!=='INR' || Number(payment.amount)!==Number(ord.rows[0].amount_paise) || payment.status!=='captured') throw new Error('Payment validation failed');
  if(payment.qr_code_id && payment.qr_code_id!==ord.rows[0].qr_code_id) throw new Error('Payment QR mismatch');
  const utr=payment?.acquirer_data?.rrn || payment?.acquirer_data?.bank_transaction_id || null;
  await q("UPDATE orders SET status='payment_received',payment_id=$1,utr=COALESCE($2,utr) WHERE order_id=$3",[paymentId,utr,orderId]);
}

async function recordPayment(orderId,paymentId){
  const ord=await q('SELECT * FROM orders WHERE order_id=$1',[orderId]);
  if(!ord.rows[0] || ord.rows[0].status==='approved' || ord.rows[0].status==='paid') return;
  const payment=await razorpay.payments.fetch(paymentId);
  if(!payment || payment.currency!=='INR' || Number(payment.amount)!==Number(ord.rows[0].amount_paise) || payment.status!=='captured') throw new Error('Payment validation failed');
  if(payment.order_id!==orderId) throw new Error('Payment does not belong to this order');
  const utr=payment?.acquirer_data?.rrn || payment?.acquirer_data?.bank_transaction_id || null;
  await q("UPDATE orders SET status='payment_received',payment_id=$1,utr=COALESCE($2,utr) WHERE order_id=$3",[paymentId,utr,orderId]);
}

async function fulfillQr(orderId,paymentId,qrCodeId){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const ord=await client.query('SELECT * FROM orders WHERE order_id=$1 FOR UPDATE',[orderId]);
    if(!ord.rows[0]) throw new Error('Order not found');
    if(ord.rows[0].status==='paid'){ await client.query('COMMIT'); return; }
    if(!paymentId) throw new Error('Missing payment id');
    if(qrCodeId && ord.rows[0].qr_code_id!==qrCodeId) throw new Error('QR code does not belong to this order');
    const payment=await razorpay.payments.fetch(paymentId);
    if(!payment) throw new Error('Payment not found');
    if(payment.currency!=='INR') throw new Error('Invalid payment currency');
    if(Number(payment.amount)!==Number(ord.rows[0].amount_paise)) throw new Error('Payment amount mismatch');
    if(payment.status!=='captured') throw new Error('Payment is not captured');
    if(payment.qr_code_id && payment.qr_code_id!==ord.rows[0].qr_code_id) throw new Error('Payment QR mismatch');
    const items=await client.query("SELECT id,login_id,login_password,extra_data FROM inventory WHERE status='available' ORDER BY id ASC FOR UPDATE SKIP LOCKED LIMIT $1",[ord.rows[0].package_qty]);
    if(items.rows.length<ord.rows[0].package_qty){ await client.query('ROLLBACK'); throw new Error('Insufficient stock at fulfillment'); }
    for(const item of items.rows){
      await client.query("UPDATE inventory SET status='sold',sold_order_id=$1,reserved_order_id=NULL WHERE id=$2",[orderId,item.id]);
      await client.query('INSERT INTO order_items(order_id,inventory_id) VALUES($1,$2)',[orderId,item.id]);
    }
    const utr=payment?.acquirer_data?.rrn || payment?.acquirer_data?.bank_transaction_id || null;
    await client.query("UPDATE orders SET status='approved',payment_id=$1,utr=$2,fulfilled_at=NOW() WHERE order_id=$3",[paymentId,utr,orderId]);
    await client.query('COMMIT');
  }catch(e){try{await client.query('ROLLBACK')}catch{};throw e;}finally{client.release();}
}

async function getQrPayments(qrId){
  const data=await razorpayApi('/payments/qr_codes/'+encodeURIComponent(qrId)+'/payments?count=20',{method:'GET'});
  return Array.isArray(data.items)?data.items:[];
}

app.post('/api/orders/:orderId/utr',async(req,res)=>{
  try{
    const orderId=String(req.params.orderId||'').trim();
    const utr=String(req.body?.utr||'').trim().replace(/\s+/g,'');
    if(!orderId || !utr || utr.length<4 || utr.length>100) return res.status(400).json({error:'Please enter a valid UTR / Transaction ID'});
    const ord=await q('SELECT * FROM orders WHERE order_id=$1',[orderId]);
    if(!ord.rows[0]) return res.status(404).json({error:'Order not found'});
    const order=ord.rows[0];
    if(order.status==='approved' || order.status==='paid') return res.json({ok:true,status:'approved',...await getOrderItems(orderId)});
    if(order.status==='rejected') return res.status(400).json({error:'This order was rejected'});
    if(Date.now() > new Date(order.created_at).getTime()+300000) return res.status(410).json({error:'QR expired. Please start a new order.'});
    const duplicate=await q('SELECT order_id,status FROM orders WHERE LOWER(utr)=LOWER($1) AND order_id<>$2 LIMIT 1',[utr,orderId]);
    if(duplicate.rows[0]) return res.status(409).json({error:'This UTR is already submitted for another order'});
    const r=await q("UPDATE orders SET status='payment_received',utr=$1 WHERE order_id=$2 AND status='created' RETURNING order_id,utr,package_qty,amount_paise,status",[utr,orderId]);
    if(!r.rows[0]){
      const latest=await q('SELECT * FROM orders WHERE order_id=$1',[orderId]);
      if(latest.rows[0]?.status==='payment_received') return res.json({ok:true,status:'pending_approval',order:latest.rows[0]});
      return res.status(400).json({error:'Order cannot accept UTR in its current state'});
    }
    res.json({ok:true,status:'pending_approval',order:r.rows[0]});
  }catch(e){console.error('UTR submit error:',e);res.status(500).json({error:'Could not submit UTR'});}
});

app.get('/api/payment/qr-status/:orderId',async(req,res)=>{
  try{
    const ord=await q('SELECT order_id,status,utr,payment_id,package_qty,amount_paise,created_at,fulfilled_at FROM orders WHERE order_id=$1',[req.params.orderId]);
    if(!ord.rows[0]) return res.status(404).json({error:'Order not found'});
    const order=ord.rows[0];
    if(order.status==='approved' || order.status==='paid') return res.json({status:'approved',...await getOrderItems(order.order_id)});
    if(order.status==='payment_received') return res.json({status:'pending_approval',order});
    const expiresAt=new Date(order.created_at).getTime()+300000;
    res.json({status:Date.now()>expiresAt?'expired':'pending',expiresAt});
  }catch(e){console.error('Manual QR status error:',e);res.status(500).json({error:e.message||'Could not check order'});}
});

async function fulfillManual(orderId){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const ord=await client.query('SELECT * FROM orders WHERE order_id=$1 FOR UPDATE',[orderId]);
    if(!ord.rows[0]) throw new Error('Order not found');
    if(ord.rows[0].status==='approved' || ord.rows[0].status==='paid'){ await client.query('COMMIT'); return; }
    if(ord.rows[0].status!=='payment_received' || !ord.rows[0].utr) throw new Error('UTR/payment is still pending');
    const items=await client.query("SELECT id,login_id,login_password,extra_data FROM inventory WHERE status='available' ORDER BY id ASC FOR UPDATE SKIP LOCKED LIMIT $1",[ord.rows[0].package_qty]);
    if(items.rows.length<ord.rows[0].package_qty){ await client.query('ROLLBACK'); throw new Error('Insufficient stock at fulfillment'); }
    for(const item of items.rows){
      await client.query("UPDATE inventory SET status='sold',sold_order_id=$1,reserved_order_id=NULL WHERE id=$2",[orderId,item.id]);
      await client.query('INSERT INTO order_items(order_id,inventory_id) VALUES($1,$2)',[orderId,item.id]);
    }
    await client.query("UPDATE orders SET status='approved',fulfilled_at=NOW() WHERE order_id=$1",[orderId]);
    await client.query('COMMIT');
  }catch(e){try{await client.query('ROLLBACK')}catch{};throw e;}finally{client.release();}
}

async function fulfill(orderId,paymentId){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const ord=await client.query('SELECT * FROM orders WHERE order_id=$1 FOR UPDATE',[orderId]);
    if(!ord.rows[0]) throw new Error('Order not found');
    if(ord.rows[0].status==='paid') { await client.query('COMMIT'); return; }

    // NEVER release inventory from a client-side callback alone.
    // Re-check the payment directly with Razorpay before marking the order paid.
    if(!paymentId) throw new Error('Missing payment id');
    const payment=await razorpay.payments.fetch(paymentId);
    if(!payment || payment.order_id!==orderId) throw new Error('Payment does not belong to this order');
    if(payment.currency!=='INR') throw new Error('Invalid payment currency');
    if(Number(payment.amount)!==Number(ord.rows[0].amount_paise)) throw new Error('Payment amount mismatch');
    if(payment.status!=='captured') throw new Error('Payment is not captured');

    const items=await client.query("SELECT id,login_id,login_password,extra_data FROM inventory WHERE status='available' ORDER BY id ASC FOR UPDATE SKIP LOCKED LIMIT $1",[ord.rows[0].package_qty]);
    if(items.rows.length<ord.rows[0].package_qty){ await client.query('ROLLBACK'); throw new Error('Insufficient stock at fulfillment'); }
    for(const item of items.rows){
      await client.query("UPDATE inventory SET status='sold',sold_order_id=$1,reserved_order_id=NULL WHERE id=$2",[orderId,item.id]);
      await client.query('INSERT INTO order_items(order_id,inventory_id) VALUES($1,$2)',[orderId,item.id]);
    }
    let utr=null;
    try{ if(paymentId){ const p=await razorpay.payments.fetch(paymentId); utr=p?.acquirer_data?.rrn || p?.acquirer_data?.bank_transaction_id || null; } }catch{}
    await client.query("UPDATE orders SET status='approved',payment_id=$1,utr=$2,fulfilled_at=NOW() WHERE order_id=$3",[paymentId||null,utr,orderId]);
    await client.query('COMMIT');
  }catch(e){ try{await client.query('ROLLBACK')}catch{}; throw e; } finally{client.release();}
}

app.post('/api/payment/verify',async(req,res)=>res.status(410).json({error:'Checkout verification is disabled. Please pay using the QR shown on screen.'}));

async function getOrderItems(utrOrOrder){
  const ord=await q('SELECT order_id,status,package_qty,amount_paise,payment_id,utr,created_at,fulfilled_at FROM orders WHERE order_id=$1 OR utr=$1 OR payment_id=$1 ORDER BY created_at DESC LIMIT 1',[utrOrOrder]);
  if(!ord.rows[0]) return {found:false};
  const order=ord.rows[0];
  if(order.status==='approved' || order.status==='paid'){
    const items=await q('SELECT i.login_id,i.login_password,i.extra_data FROM order_items oi JOIN inventory i ON i.id=oi.inventory_id WHERE oi.order_id=$1 ORDER BY i.id',[order.order_id]);
    return {found:true,status:'approved',order,items:items.rows};
  }
  return {found:true,status:order.status==='rejected'?'rejected':'pending',order,items:[]};
}
app.get('/api/order-check/:utr',async(req,res)=>{ try{res.json(await getOrderItems(req.params.utr.trim()));}catch{res.status(500).json({error:'Server error'});} });

app.get('/admin', (req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));

(async()=>{
  try{
    await q(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));
    app.listen(PORT,()=>console.log(`NISHAD BRAND running on ${PORT}`));
  }catch(e){ console.error('Startup DB error:',e); process.exit(1); }
})();
