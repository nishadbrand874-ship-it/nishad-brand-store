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

// Razorpay webhook MUST receive the raw request body for signature verification.
app.post('/api/payment/webhook', express.raw({type:'application/json'}), async (req,res)=>{
  try{
    const crypto=require('crypto');
    const signature=req.headers['x-razorpay-signature'];
    const secret=process.env.RAZORPAY_WEBHOOK_SECRET || '';
    if(!signature || !secret || !Buffer.isBuffer(req.body)) return res.status(400).send('invalid webhook');
    const expected=crypto.createHmac('sha256',secret).update(req.body).digest('hex');
    const a=Buffer.from(expected,'utf8'), b=Buffer.from(String(signature),'utf8');
    if(a.length!==b.length || !crypto.timingSafeEqual(a,b)) return res.status(400).send('invalid signature');
    const payload=JSON.parse(req.body.toString('utf8'));
    if(payload.event==='order.paid' || payload.event==='payment.captured'){
      const entity=payload.payload?.payment?.entity;
      const orderId=entity?.order_id || payload.payload?.order?.entity?.id;
      const paymentId=entity?.id;
      if(orderId) await fulfill(orderId,paymentId);
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
  return {siteName:s.site_name||'NISHAD BRAND', whatsapp:s.whatsapp_number||'', logo:s.logo_data||'/logo.png', qr:s.qr_data||'/payment-qr.png', pricePerId:basePrice, packages, stock};
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
  const allowed=['site_name','whatsapp_number','price_per_id'];
  for(const key of allowed){ if(req.body[key]!==undefined) await q('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',[key,String(req.body[key])]); }
  res.json({ok:true});
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

async function createOrder(req,res){
  const qty=Number(req.body.qty), name=(req.body.name||'').trim(), phone=(req.body.phone||'').trim();
  if(!Number.isInteger(qty) || qty < 1 || qty > 1000) return res.status(400).json({error:'Quantity must be between 1 and 1000'});
  const basePrice=Number(await setting('price_per_id') || await setting('package_1'));
  const price=Math.round(basePrice * qty * 100) / 100;
  if(!price) return res.status(400).json({error:'Package not configured'});
  const count=await q("SELECT COUNT(*)::int AS count FROM inventory WHERE status='available'");
  if(count.rows[0].count<qty) return res.status(409).json({error:'Not enough stock'});
  if(!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return res.status(503).json({error:'Payment gateway is not configured yet'});
  try{
    const rpOrder=await razorpay.orders.create({amount:money(price),currency:'INR',receipt:'NB'+Date.now()+Math.floor(Math.random()*1000),notes:{package_qty:String(qty)}});
    await q('INSERT INTO orders(order_id,package_qty,amount_paise,status,customer_name,customer_phone) VALUES($1,$2,$3,$4,$5,$6)',[rpOrder.id,qty,money(price),'created',name,phone]);
    res.json({orderId:rpOrder.id,amount:money(price),currency:'INR',keyId:process.env.RAZORPAY_KEY_ID});
  }catch(e){console.error(e);res.status(500).json({error:'Could not create payment order'});}
}
app.post('/api/orders',createOrder);

async function fulfill(orderId,paymentId){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const ord=await client.query('SELECT * FROM orders WHERE order_id=$1 FOR UPDATE',[orderId]);
    if(!ord.rows[0]) throw new Error('Order not found');
    if(ord.rows[0].status==='paid') { await client.query('COMMIT'); return; }
    const items=await client.query("SELECT id,login_id,login_password,extra_data FROM inventory WHERE status='available' ORDER BY id ASC FOR UPDATE SKIP LOCKED LIMIT $1",[ord.rows[0].package_qty]);
    if(items.rows.length<ord.rows[0].package_qty){ await client.query('ROLLBACK'); throw new Error('Insufficient stock at fulfillment'); }
    for(const item of items.rows){
      await client.query("UPDATE inventory SET status='sold',sold_order_id=$1,reserved_order_id=NULL WHERE id=$2",[orderId,item.id]);
      await client.query('INSERT INTO order_items(order_id,inventory_id) VALUES($1,$2)',[orderId,item.id]);
    }
    let utr=null;
    try{ if(paymentId){ const p=await razorpay.payments.fetch(paymentId); utr=p?.acquirer_data?.rrn || p?.acquirer_data?.bank_transaction_id || null; } }catch{}
    await client.query("UPDATE orders SET status='paid',payment_id=$1,utr=$2,fulfilled_at=NOW() WHERE order_id=$3",[paymentId||null,utr,orderId]);
    await client.query('COMMIT');
  }catch(e){ try{await client.query('ROLLBACK')}catch{}; throw e; } finally{client.release();}
}

app.post('/api/payment/verify',async(req,res)=>{
  const {razorpay_order_id,razorpay_payment_id,razorpay_signature}=req.body||{};
  if(!razorpay_order_id||!razorpay_payment_id||!razorpay_signature) return res.status(400).json({error:'Missing payment data'});
  const crypto=require('crypto');
  const secret=process.env.RAZORPAY_KEY_SECRET || '';
  if(!secret) return res.status(503).json({error:'Payment gateway is not configured'});
  const expected=crypto.createHmac('sha256',secret).update(razorpay_order_id+'|'+razorpay_payment_id).digest('hex');
  const a=Buffer.from(expected,'utf8'), b=Buffer.from(String(razorpay_signature),'utf8');
  if(a.length!==b.length || !crypto.timingSafeEqual(a,b)) return res.status(400).json({error:'Payment signature verification failed'});
  try{
    const ord=await q('SELECT * FROM orders WHERE order_id=$1',[razorpay_order_id]);
    if(!ord.rows[0]) return res.status(404).json({error:'Order not found'});
    const payment=await razorpay.payments.fetch(razorpay_payment_id);
    if(payment.order_id!==razorpay_order_id) return res.status(400).json({error:'Payment does not belong to this order'});
    if(Number(payment.amount)!==Number(ord.rows[0].amount_paise) || payment.currency!=='INR') return res.status(400).json({error:'Payment amount mismatch'});
    if(payment.status!=='captured') return res.status(400).json({error:'Payment is not captured yet'});
    await fulfill(razorpay_order_id,razorpay_payment_id);
    const result=await getOrderItems(razorpay_order_id);
    res.json({ok:true,...result});
  }catch(e){console.error('Payment verification error:',e);res.status(500).json({error:'Payment verified but fulfillment is pending; please use UTR check shortly'});}
});

async function getOrderItems(utrOrOrder){
  const ord=await q('SELECT order_id,status,package_qty,amount_paise,payment_id,utr,created_at FROM orders WHERE order_id=$1 OR utr=$1 OR payment_id=$1 ORDER BY created_at DESC LIMIT 1',[utrOrOrder]);
  if(!ord.rows[0]) return {found:false};
  const items=await q('SELECT i.login_id,i.login_password,i.extra_data FROM order_items oi JOIN inventory i ON i.id=oi.inventory_id WHERE oi.order_id=$1 ORDER BY i.id',[ord.rows[0].order_id]);
  return {found:true,order:ord.rows[0],items:items.rows};
}
app.get('/api/order-check/:utr',async(req,res)=>{ try{res.json(await getOrderItems(req.params.utr.trim()));}catch{res.status(500).json({error:'Server error'});} });

app.get('/admin', (req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));

(async()=>{
  try{
    await q(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));
    app.listen(PORT,()=>console.log(`NISHAD BRAND running on ${PORT}`));
  }catch(e){ console.error('Startup DB error:',e); process.exit(1); }
})();
