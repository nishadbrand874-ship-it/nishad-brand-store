require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');

const app = express();
app.set('trust proxy', 1);
const ADMIN_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-nishad_admin' : 'nishad_admin';
const CF_GATE_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-nishad_cf_verified' : 'nishad_cf_verified';
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024, files: 2 },
  fileFilter: (req, file, cb) => {
    const allowed = new Set(['image/png','image/jpeg','image/webp']);
    cb(null, allowed.has(String(file.mimetype || '').toLowerCase()));
  }
});

// Security: inventory credentials are encrypted at rest and never returned
// as a full inventory dump to the browser. Keep INVENTORY_ENCRYPTION_KEY
// stable in Render Environment Variables; it should be a long random secret.
const rawInventoryKey = String(process.env.INVENTORY_ENCRYPTION_KEY || '');
if (process.env.NODE_ENV === 'production' && rawInventoryKey.length < 32) {
  console.error('INVENTORY_ENCRYPTION_KEY must be set to a random secret of at least 32 characters in production.');
  process.exit(1);
}
const INVENTORY_KEY = crypto.createHash('sha256')
  .update(rawInventoryKey || String(process.env.JWT_SECRET || ''))
  .digest();
if (process.env.NODE_ENV === 'production') {
  const jwtSecret=String(process.env.JWT_SECRET||'');
  const adminUser=String(process.env.ADMIN_USERNAME||'');
  const adminPass=String(process.env.ADMIN_PASSWORD||'');
  if (jwtSecret.length < 32 || adminUser.length < 3 || adminPass.length < 12) {
    console.error('Production security configuration is incomplete: JWT_SECRET >=32 chars, ADMIN_USERNAME >=3 chars, ADMIN_PASSWORD >=12 chars required.');
    process.exit(1);
  }
}
function encryptSecret(value){
  if(value == null || value === '') return value == null ? null : '';
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm', INVENTORY_KEY, iv);
  const enc=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]);
  return 'enc:v1:'+iv.toString('base64url')+':'+cipher.getAuthTag().toString('base64url')+':'+enc.toString('base64url');
}
function decryptSecret(value){
  if(value == null || value === '') return value || '';
  if(!String(value).startsWith('enc:v1:')) return String(value); // legacy row; migration upgrades it
  const [,v,iv64,tag64,data64]=String(value).split(':');
  try{
    const decipher=crypto.createDecipheriv('aes-256-gcm', INVENTORY_KEY, Buffer.from(iv64,'base64url'));
    decipher.setAuthTag(Buffer.from(tag64,'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data64,'base64url')),decipher.final()]).toString('utf8');
  }catch{return ''}
}
function maskSecret(value){
  const s=String(value||'');
  if(!s) return '';
  return s.length<=3 ? '•••' : '••••••••'+s.slice(-3);
}

// Basic security headers (no extra package required).
app.disable('x-powered-by');
app.use((req,res,next)=>{
  res.set({
    'X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'DENY',
    'Referrer-Policy':'strict-origin-when-cross-origin',
    'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy':"default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com;"
  });
  if (process.env.NODE_ENV === 'production') res.set('Strict-Transport-Security','max-age=31536000; includeSubDomains');
  next();
});
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
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve the storefront with the Turnstile Site Key embedded for the first-load gate.
app.get('/', (req,res)=>{
  try {
    const file=fs.readFileSync(path.join(__dirname,'public','index.html'),'utf8');
    const siteKey=String(process.env.CLOUDFLARE_TURNSTILE_SITE_KEY||'').trim().replace(/&/g,'&amp;').replace(/\"/g,'&quot;').replace(/</g,'&lt;');
    res.set('Cache-Control','no-store');
    res.type('html').send(file.replace('__CF_TURNSTILE_SITE_KEY__',siteKey));
  } catch { res.status(500).send('Storefront unavailable'); }
});
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req,res)=>res.json({ok:true,service:'nishad-brand-store'}));

const loginAttempts=new Map();
const apiHits=new Map();
const claimHits=new Map();
function clientIp(req){ return String(req.ip||'unknown').slice(0,100); }
function rateLimit(map,windowMs,max,code='Too many requests. Please try again later.'){
  return (req,res,next)=>{
    const key=clientIp(req); const now=Date.now(); const a=map.get(key);
    if(!a || now-a.first>=windowMs){ map.set(key,{first:now,count:1}); return next(); }
    a.count++;
    if(a.count>max) return res.status(429).json({error:code});
    next();
  };
}
function loginRateLimit(req,res,next){
  const ip=clientIp(req);
  const username=String(req.body?.username||'').slice(0,120).toLowerCase();
  const key=ip+'|'+username;
  const now=Date.now(); const a=loginAttempts.get(key);
  if(a && now-a.first<10*60*1000 && a.count>=8) return res.status(429).json({error:'Too many login attempts. Try again later.'});
  req._loginKey=key; next();
}
function recordLoginFailure(key){
  const now=Date.now(); const a=loginAttempts.get(key);
  if(!a || now-a.first>=10*60*1000) loginAttempts.set(key,{first:now,count:1});
  else a.count++;
}
function clearLoginFailures(key){loginAttempts.delete(key);}
setInterval(()=>{ const now=Date.now(); for(const [k,v] of loginAttempts) if(now-v.first>10*60*1000) loginAttempts.delete(k); for(const [k,v] of apiHits) if(now-v.first>60*1000) apiHits.delete(k); for(const [k,v] of claimHits) if(now-v.first>10*60*1000) claimHits.delete(k); },5*60*1000).unref();


function siteGate(req,res,next){
  try {
    const token=String(req.cookies[CF_GATE_COOKIE]||'');
    if(!token) return res.status(403).json({error:'Cloudflare verification required'});
    const data=jwt.verify(token, process.env.JWT_SECRET);
    if(data?.type!=='cloudflare_gate') throw new Error('Invalid gate');
    next();
  } catch { res.status(403).json({error:'Cloudflare verification required'}); }
}
function signSiteGateToken(){ return jwt.sign({type:'cloudflare_gate',jti:crypto.randomBytes(16).toString('hex')}, process.env.JWT_SECRET, {expiresIn:'12h'}); }

function auth(req,res,next){
  try {
    const token = req.cookies[ADMIN_COOKIE];
    if(!token) return res.status(401).json({error:'Unauthorized'});
    req.admin = jwt.verify(token, process.env.JWT_SECRET);
    if(req.admin?.role!=='admin') throw new Error('Invalid role');
    next();
  } catch { res.status(401).json({error:'Unauthorized'}); }
}
function money(n){ return Math.round(Number(n)*100); }
function signToken(){ return jwt.sign({role:'admin',jti:crypto.randomBytes(16).toString('hex')}, process.env.JWT_SECRET, {expiresIn:'2h'}); }
async function q(text, params=[]){ return pool.query(text, params); }
async function migrateOrdersSchema(){
  // Backward-compatible migration for existing databases created before qr_code_id was added.
  // CREATE TABLE IF NOT EXISTS does not modify an already-existing orders table.
  await q('ALTER TABLE orders ADD COLUMN IF NOT EXISTS qr_code_id TEXT');
  await q('ALTER TABLE orders ADD COLUMN IF NOT EXISTS claim_used_at TIMESTAMPTZ');
  await q('ALTER TABLE orders ADD COLUMN IF NOT EXISTS claim_requested_at TIMESTAMPTZ');
  await q("ALTER TABLE orders ADD COLUMN IF NOT EXISTS claim_status TEXT");
  try {
    await q('CREATE UNIQUE INDEX IF NOT EXISTS orders_qr_code_id_unique ON orders(qr_code_id) WHERE qr_code_id IS NOT NULL');
  } catch (e) {
    console.warn('QR code index migration skipped:', e.message);
  }
}

async function migrateInventoryEncryption(){
  // Upgrade legacy plaintext inventory rows once. Only the server can decrypt them.
  const r=await q("SELECT id,login_id,login_password,extra_data FROM inventory WHERE login_id NOT LIKE 'enc:v1:%' OR (login_password IS NOT NULL AND login_password NOT LIKE 'enc:v1:%') OR (extra_data IS NOT NULL AND extra_data NOT LIKE 'enc:v1:%') LIMIT 1000");
  for(const row of r.rows){
    await q('UPDATE inventory SET login_id=$1,login_password=$2,extra_data=$3 WHERE id=$4',[encryptSecret(row.login_id),encryptSecret(row.login_password),encryptSecret(row.extra_data),row.id]);
  }
  if(r.rows.length) console.log(`Encrypted ${r.rows.length} legacy inventory records.`);
}

async function normalizeStorePrice(){ try {
  const current=await setting('price_per_id');
  if(!current || !Number.isFinite(Number(current)) || Number(current)<=0){
    await q("INSERT INTO settings(key,value) VALUES ('price_per_id','1') ON CONFLICT(key) DO NOTHING");
    await q("INSERT INTO settings(key,value) VALUES ('bonus_offer_enabled','true') ON CONFLICT(key) DO NOTHING");
  }
 } catch(e) { console.warn('Price initialization skipped:', e.message); } }
async function setting(key){ const r=await q('SELECT value FROM settings WHERE key=$1',[key]); return r.rows[0]?.value || ''; }
async function settings(){ const r=await q('SELECT key,value FROM settings'); return Object.fromEntries(r.rows.map(x=>[x.key,x.value])); }
function publicSettings(s, stock=0){
  // Price per ID is controlled from Admin Panel → Store Settings.
  // Fall back to ₹1 only when no valid price has been saved yet.
  const savedPrice = Number(s.price_per_id);
  const basePrice = Number.isFinite(savedPrice) && savedPrice > 0 ? savedPrice : 1;
  const packages = [1,2,5,10,15,20].map(qty=>({
    qty,
    price: Math.round(basePrice * qty * 100) / 100,
    available: stock >= qty
  }));
  return {siteName:s.site_name||'NISHAD BRAND', whatsapp:s.whatsapp_number||'', logo:s.logo_data||'/logo.png', qr:s.qr_data||'/payment-qr.png', news:s.news||'', pricePerId:basePrice, packages, stock, turnstileSiteKey:String(process.env.CLOUDFLARE_TURNSTILE_SITE_KEY||'').trim(), bonusOfferEnabled:s.bonus_offer_enabled!=='false'};
}

app.post('/api/site-verify', rateLimit(apiHits,60*1000,30), async (req,res)=>{
  try {
    const secret=String(process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY||'').trim();
    const token=String(req.body?.token||'').trim();
    if(!secret) return res.status(503).json({error:'Cloudflare protection is not configured'});
    if(!token) return res.status(400).json({error:'Cloudflare verification required'});
    const body=new URLSearchParams({secret,response:token});
    const ip=clientIp(req); if(ip && ip!=='unknown') body.set('remoteip',ip);
    const r=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
    const cf=await r.json();
    const host=String(cf?.hostname||'').toLowerCase();
    if(!cf?.success || (host && host!=='nishadbrand.online' && host!=='www.nishadbrand.online')) return res.status(403).json({error:'Cloudflare verification failed'});
    res.cookie(CF_GATE_COOKIE,signSiteGateToken(),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:12*60*60*1000});
    res.json({ok:true});
  } catch(e){ console.error('Cloudflare site verification error:',e.message); res.status(502).json({error:'Cloudflare verification failed'}); }
});

app.get('/api/config', siteGate, async (req,res)=>{
  res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma','no-cache');
  try {
    const s=await settings();
    const stock=await q("SELECT COUNT(*)::int AS count FROM inventory WHERE status='available'");
    res.json(publicSettings(s, stock.rows[0].count));
  } catch(e){ console.error('Config error:',e); res.status(500).json({error:'Server error'}); }
});

app.post('/api/admin/login', loginRateLimit, async (req,res)=>{
  const {username,password}=req.body||{};
  const okUser=username===process.env.ADMIN_USERNAME;
  const configured=process.env.ADMIN_PASSWORD||'';
  const okPass=configured.startsWith('$2') ? await bcrypt.compare(password||'',configured) : password===configured;
  if(!okUser || !okPass){ recordLoginFailure(req._loginKey); return res.status(401).json({error:'Invalid login'}); }
  clearLoginFailures(req._loginKey);
  res.cookie(ADMIN_COOKIE,signToken(),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:2*60*60*1000});
  res.json({ok:true});
});
app.post('/api/admin/logout',(req,res)=>{res.clearCookie(ADMIN_COOKIE,{path:'/'});res.json({ok:true});});
app.get('/api/admin/me',auth,(req,res)=>res.json({ok:true}));

app.get('/api/admin/dashboard',auth,async(req,res)=>{
  res.set('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
  const s=await settings();
  const stock=await q("SELECT COUNT(*)::int AS count FROM inventory WHERE status='available'");
  const sold=await q("SELECT COUNT(*)::int AS count FROM inventory WHERE status='sold'");
  const orders=await q("SELECT order_id,package_qty,amount_paise,status,payment_id,utr,customer_name,customer_phone,created_at,fulfilled_at,claim_used_at,claim_requested_at,claim_status FROM orders ORDER BY created_at DESC LIMIT 100");
  const inv=await q("SELECT id,status,sold_order_id,created_at FROM inventory ORDER BY id DESC LIMIT 500");
  const today=await q(`SELECT
    (SELECT COUNT(*)::int FROM inventory WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date AND status='sold') AS today_sold_ids,
    (SELECT COUNT(*)::int FROM inventory WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date) AS today_ids_added,
    (SELECT COUNT(*)::int FROM orders WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date AND status='rejected') AS today_rejected,
    (SELECT COUNT(*)::int FROM orders WHERE (fulfilled_at AT TIME ZONE 'Asia/Kolkata')::date=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date AND status IN ('approved','paid')) AS today_approved`);
  res.json({settings:s,stock:stock.rows[0].count,sold:sold.rows[0].count,orders:orders.rows,inventory:inv.rows,today:today.rows[0]});
});

app.post('/api/admin/settings',auth,async(req,res)=>{
  const allowed=['site_name','whatsapp_number','price_per_id','upi_vpa','upi_name','news','bonus_offer_enabled'];
  if(req.body.price_per_id!==undefined){
    const price=Number(req.body.price_per_id);
    if(!Number.isFinite(price) || price<=0 || price>100000){
      return res.status(400).json({error:'Invalid price per ID'});
    }
    req.body.price_per_id=price.toFixed(2).replace(/\.00$/,'');
  }
  for(const key of allowed){ if(req.body[key]!==undefined) await q('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',[key,String(req.body[key])]); }
  const fresh=await settings();
  res.json({ok:true,pricePerId:Number(fresh.price_per_id)||1});
});
app.post('/api/admin/orders/:orderId/approve',auth,async(req,res)=>{
  try{
    const ord=await q("SELECT * FROM orders WHERE order_id=$1",[req.params.orderId]);
    if(!ord.rows[0]) return res.status(404).json({error:'Order not found'});
    if(ord.rows[0].status==='approved' || ord.rows[0].status==='paid') return res.json({ok:true,already:true});
    if(ord.rows[0].status!=='payment_received') return res.status(400).json({error:'Payment has not been verified yet'});
    if(!ord.rows[0].utr) return res.status(400).json({error:'UTR / Transaction ID is required before approval'});
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
  if(rows.length>500) return res.status(400).json({error:'Maximum 500 IDs per upload'});
  if(!rows.length) return res.status(400).json({error:'No IDs provided'});
  const client=await pool.connect();
  try{ await client.query('BEGIN'); for(const item of rows){ if(!item.login_id) continue; await client.query('INSERT INTO inventory(login_id,login_password,extra_data) VALUES($1,$2,$3)',[encryptSecret(item.login_id),encryptSecret(item.login_password||null),encryptSecret(item.extra_data||null)]); } await client.query('COMMIT'); res.json({ok:true}); }
  catch(e){await client.query('ROLLBACK');res.status(500).json({error:'Could not add inventory'});} finally{client.release();}
});
app.delete('/api/admin/inventory/:id',auth,async(req,res)=>{ await q("DELETE FROM inventory WHERE id=$1 AND status='available'",[req.params.id]); res.json({ok:true}); });

async function createOrder(req,res){
  const qty=Number(req.body.qty), name=(req.body.name||'').trim(), phone=(req.body.phone||'').trim();
  if(!Number.isInteger(qty) || qty < 1 || qty > 1000) return res.status(400).json({error:'Quantity must be between 1 and 1000'});
  // Use the current Admin Panel price-per-ID for every new order/QR.
  const s=await settings();
  const savedPrice=Number(s.price_per_id);
  const basePrice=Number.isFinite(savedPrice) && savedPrice>0 ? savedPrice : 1;
  const price=Math.round(basePrice * qty * 100) / 100;
  if(!price) return res.status(400).json({error:'Package not configured'});
  const count=await q("SELECT COUNT(*)::int AS count FROM inventory WHERE status='available'");
  if(count.rows[0].count<qty) return res.status(409).json({error:'Not enough stock'});

  // Merchant UPI VPA extracted from the QR supplied by the store owner.
  // A fresh UPI intent QR is generated for every order so the exact amount
  // (quantity × price) is encoded in the QR itself.
  const vpa=String(s.upi_vpa || process.env.UPI_VPA || 'Q127502433@ybl').trim();
  const payee=String(s.upi_name || process.env.UPI_NAME || 'PhonePeMerchant').trim();
  if(!vpa) return res.status(500).json({error:'UPI VPA is not configured'});

  try{
    const orderId='NB'+Date.now()+crypto.randomBytes(6).toString('hex');
    const orderToken=crypto.randomBytes(32).toString('base64url');
    const orderTokenHash=crypto.createHash('sha256').update(orderToken).digest('hex');
    const amount=price.toFixed(2);
    const upiLink='upi://pay?pa='+encodeURIComponent(vpa)+'&pn='+encodeURIComponent(payee)+'&am='+encodeURIComponent(amount)+'&cu=INR&tn='+encodeURIComponent(orderId);
    const qrImage=await QRCode.toDataURL(upiLink,{width:360,margin:2,errorCorrectionLevel:'M'});
    await q('INSERT INTO orders(order_id,qr_code_id,package_qty,amount_paise,status,customer_name,customer_phone) VALUES($1,$2,$3,$4,$5,$6,$7)',[orderId,orderTokenHash,qty,money(price),'created',name,phone]);
    res.json({orderId,orderToken,qrImage,upiLink,amount:money(price),currency:'INR',quantity:qty,pricePerId:basePrice,expiresAt:Date.now()+300000});
  }catch(e){console.error('Manual UPI order create error:',e);res.status(500).json({error:e.message || 'Could not create order'});}
}
app.post('/api/orders', siteGate, rateLimit(apiHits,60*1000,20), createOrder);

function verifyOrderToken(order,token){
  if(!order || !order.qr_code_id || !token) return false;
  const expected=Buffer.from(String(order.qr_code_id),'utf8');
  const actual=Buffer.from(crypto.createHash('sha256').update(String(token)).digest('hex'),'utf8');
  return expected.length===actual.length && crypto.timingSafeEqual(expected,actual);
}

async function verifyTurnstile(token, req){
  const secret=String(process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY||'').trim();
  if(!secret) return {ok:false, reason:'Cloudflare Turnstile is not configured'};
  if(!token || String(token).length<10) return {ok:false, reason:'Cloudflare verification required'};
  try{
    const body=new URLSearchParams({secret,response:String(token),remoteip:clientIp(req)});
    const r=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
    const d=await r.json();
    return d?.success ? {ok:true} : {ok:false, reason:'Cloudflare verification failed'};
  }catch(e){ console.error('Turnstile verify error:',e); return {ok:false, reason:'Cloudflare verification unavailable'}; }
}

app.post('/api/orders/:orderId/utr', siteGate, rateLimit(apiHits,60*1000,20), async(req,res)=>{
  try{
    const cf=await verifyTurnstile(req.body?.turnstileToken,req);
    if(!cf.ok) return res.status(403).json({error:cf.reason});
    const orderId=String(req.params.orderId||'').trim();
    const orderToken=String(req.headers['x-order-token']||'').trim();
    const utr=String(req.body?.utr||'').trim().replace(/\s+/g,'');
    if(!orderId || !utr || !/^[A-Za-z0-9]{8,35}$/.test(utr)) return res.status(400).json({error:'UTR / Transaction ID must be 8–35 letters or digits (no spaces/symbols)'});
    const ord=await q('SELECT * FROM orders WHERE order_id=$1',[orderId]);
    if(!ord.rows[0]) return res.status(404).json({error:'Order not found'});
    const order=ord.rows[0];
    if(!verifyOrderToken(order,orderToken)) return res.status(403).json({error:'Invalid order session'});
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
    res.json({ok:true,status:'pending_approval',order:r.rows[0],message:'UTR recorded. Admin must verify the payment and approve it before IDs are released.'});
  }catch(e){
    console.error('UTR submit error:',e);
    if(e && e.code==='23505' && String(e.constraint||'').includes('orders_utr_unique')) return res.status(409).json({error:'This UTR has already been submitted and cannot be reused.'});
    res.status(500).json({error:'Could not submit UTR'});
  }
});

app.get('/api/payment/qr-status/:orderId', siteGate, rateLimit(apiHits,60*1000,60), async(req,res)=>{
  try{
    const ord=await q('SELECT order_id,qr_code_id,status,utr,package_qty,amount_paise,created_at,fulfilled_at FROM orders WHERE order_id=$1',[req.params.orderId]);
    if(!ord.rows[0]) return res.status(404).json({error:'Order not found'});
    const order=ord.rows[0];
    if(!verifyOrderToken(order,String(req.headers['x-order-token']||''))) return res.status(403).json({error:'Invalid order session'});
    const publicOrder={order_id:order.order_id,package_qty:order.package_qty,amount_paise:order.amount_paise,status:order.status,created_at:order.created_at,fulfilled_at:order.fulfilled_at};
    if(order.status==='approved' || order.status==='paid') return res.json({status:'approved',order:publicOrder,items:await getApprovedItems(order.order_id)});
    if(order.status==='payment_received') return res.json({status:'pending_approval',order:publicOrder});
    if(order.status==='rejected') return res.json({status:'rejected',order:publicOrder});
    const expiresAt=new Date(order.created_at).getTime()+300000;
    res.json({status:Date.now()>expiresAt?'expired':'pending',expiresAt,order:publicOrder});
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
    const items=await client.query("SELECT id FROM inventory WHERE status='available' ORDER BY id ASC FOR UPDATE SKIP LOCKED LIMIT $1",[ord.rows[0].package_qty]);
    if(items.rows.length<ord.rows[0].package_qty){ await client.query('ROLLBACK'); throw new Error('Insufficient stock at fulfillment'); }
    for(const item of items.rows){
      await client.query("UPDATE inventory SET status='sold',sold_order_id=$1,reserved_order_id=NULL WHERE id=$2",[orderId,item.id]);
      await client.query('INSERT INTO order_items(order_id,inventory_id) VALUES($1,$2)',[orderId,item.id]);
    }
    await client.query("UPDATE orders SET status='approved',fulfilled_at=NOW() WHERE order_id=$1",[orderId]);
    await client.query('COMMIT');
  }catch(e){try{await client.query('ROLLBACK')}catch{};throw e;}finally{client.release();}
}

async function getApprovedItems(orderId){
  const items=await q('SELECT i.login_id,i.login_password,i.extra_data FROM order_items oi JOIN inventory i ON i.id=oi.inventory_id WHERE oi.order_id=$1 ORDER BY i.id',[orderId]);
  return items.rows.map(i=>({login_id:decryptSecret(i.login_id),login_password:decryptSecret(i.login_password),extra_data:decryptSecret(i.extra_data)}));
}
async function getOrderItems(utr){
  const ord=await q('SELECT order_id,status,package_qty,amount_paise,created_at,fulfilled_at FROM orders WHERE LOWER(utr)=LOWER($1) ORDER BY created_at DESC LIMIT 1',[utr]);
  if(!ord.rows[0]) return {found:false};
  const order=ord.rows[0];
  const publicOrder={order_id:order.order_id,status:order.status,package_qty:order.package_qty,amount_paise:order.amount_paise,created_at:order.created_at,fulfilled_at:order.fulfilled_at};
  if(order.status==='approved' || order.status==='paid') return {found:true,status:'approved',order:publicOrder,items:await getApprovedItems(order.order_id)};
  return {found:true,status:order.status==='rejected'?'rejected':'pending',order:publicOrder,items:[]};
}
function claimRateLimit(req,res,next){
  const ip=clientIp(req);
  const now=Date.now();
  const key=ip+'|claim';
  const a=claimHits.get(key);
  if(!a || now-a.first>=10*60*1000){ claimHits.set(key,{first:now,count:1}); return next(); }
  a.count++;
  if(a.count>5) return res.status(429).json({error:'Too many claim attempts. Please try again later.'});
  next();
}
app.post('/api/claim-bonus/:utr', siteGate, claimRateLimit, async(req,res)=>{
  const utr=String(req.params.utr||'').trim().replace(/\s+/g,'');
  if(!/^[A-Za-z0-9]{8,35}$/.test(utr)) return res.status(400).json({error:'Invalid UTR / Transaction ID'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const r=await client.query('SELECT * FROM orders WHERE LOWER(utr)=LOWER($1) LIMIT 1 FOR UPDATE',[utr]);
    if(!r.rows[0]){await client.query('ROLLBACK');return res.status(404).json({error:'NOT FOUND: This UTR was not found'});}
    const order=r.rows[0];
    if(order.package_qty!==10){await client.query('ROLLBACK');return res.status(400).json({error:'NOT FOUND: This UTR is not linked to a 10 ID purchase'});}
    if(order.status!=='approved' && order.status!=='paid'){await client.query('ROLLBACK');return res.status(400).json({error:'Payment must be approved before claiming the bonus ID'});}
    const originalItems=await client.query('SELECT COUNT(*)::int AS count FROM order_items WHERE order_id=$1',[order.order_id]);
    if(originalItems.rows[0].count < 10){await client.query('ROLLBACK');return res.status(400).json({error:'NOT FOUND: This order is not eligible for the 10 ID bonus claim'});}
    if(order.claim_status==='approved' || order.claim_used_at){await client.query('ROLLBACK');return res.status(409).json({error:'This UTR has already used the 1 ID claim'});}
    if(order.claim_status==='pending' || order.claim_requested_at){
      await client.query('ROLLBACK');
      return res.json({ok:true,pending:true,message:'Claim request already sent. Waiting for admin approval.'});
    }
    if(order.claim_status==='rejected'){await client.query('ROLLBACK');return res.status(409).json({error:'This UTR claim request was rejected and cannot be claimed again'});}
    if(!order.fulfilled_at){await client.query('ROLLBACK');return res.status(400).json({error:'Claim window is not available'});}
    const deadline=new Date(order.fulfilled_at).getTime()+24*60*60*1000;
    if(Date.now()>deadline){await client.query('ROLLBACK');return res.status(410).json({error:'24-hour claim window has expired'});}
    await client.query("UPDATE orders SET claim_requested_at=NOW(), claim_status='pending' WHERE order_id=$1",[order.order_id]);
    await client.query('COMMIT');
    res.json({ok:true,pending:true,message:'Claim request sent to admin for approval.',orderId:order.order_id,utr:order.utr});
  }catch(e){try{await client.query('ROLLBACK')}catch{};console.error('Claim request error:',e);res.status(500).json({error:'Could not submit claim request'});}
  finally{client.release();}
});

app.post('/api/admin/manual-bonus-release/:utr',auth,async(req,res)=>{
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const r=await client.query("SELECT * FROM orders WHERE LOWER(utr)=LOWER($1) ORDER BY created_at DESC LIMIT 1 FOR UPDATE",[String(req.params.utr||'').trim()]);
    const order=r.rows[0];
    if(!order){await client.query('ROLLBACK');return res.status(404).json({error:'NOT FOUND: UTR not found'});}
    if(order.package_qty!==10 || (order.status!=='approved' && order.status!=='paid')){await client.query('ROLLBACK');return res.status(400).json({error:'This UTR is not an approved 10 ID purchase'});}
    if(order.claim_status==='approved' || order.claim_used_at){await client.query('ROLLBACK');return res.status(409).json({error:'This UTR has already used the 1 ID bonus claim'});}
    if(!order.fulfilled_at || Date.now()>new Date(order.fulfilled_at).getTime()+24*60*60*1000){await client.query('ROLLBACK');return res.status(410).json({error:'24-hour bonus claim window has expired'});}
    const stock=await client.query("SELECT id FROM inventory WHERE status='available' ORDER BY id ASC LIMIT 1 FOR UPDATE");
    if(!stock.rows[0]){await client.query('ROLLBACK');return res.status(409).json({error:'Bonus ID is out of stock'});}
    const inventoryId=stock.rows[0].id;
    await client.query("UPDATE inventory SET status='sold',sold_order_id=$1 WHERE id=$2",[order.order_id+'-BONUS',inventoryId]);
    await client.query("INSERT INTO order_items(order_id,inventory_id) VALUES($1,$2)",[order.order_id,inventoryId]);
    await client.query("UPDATE orders SET claim_used_at=NOW(),claim_status='approved',claim_requested_at=COALESCE(claim_requested_at,NOW()) WHERE order_id=$1",[order.order_id]);
    const claimed=await client.query('SELECT login_id,login_password,extra_data FROM inventory WHERE id=$1',[inventoryId]);
    await client.query('COMMIT');
    res.json({ok:true,utr:order.utr,order_id:order.order_id,bonus:claimed.rows[0]});
  }catch(e){try{await client.query('ROLLBACK')}catch{};console.error('Manual bonus release error:',e);res.status(500).json({error:'Could not manually release bonus ID'});}finally{client.release();}
});

app.post('/api/admin/orders/:orderId/claim-approve',auth,async(req,res)=>{
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const r=await client.query('SELECT * FROM orders WHERE order_id=$1 FOR UPDATE',[req.params.orderId]);
    if(!r.rows[0]){await client.query('ROLLBACK');return res.status(404).json({error:'Order not found'});}
    const order=r.rows[0];
    if(order.package_qty!==10 || (order.status!=='approved' && order.status!=='paid')){await client.query('ROLLBACK');return res.status(400).json({error:'Only an approved 10 ID purchase can receive the bonus'});}
    if(order.claim_status==='approved' || order.claim_used_at){await client.query('ROLLBACK');return res.json({ok:true,already:true});}
    if(order.claim_status!=='pending'){await client.query('ROLLBACK');return res.status(400).json({error:'No pending claim request'});}
    if(!order.fulfilled_at || Date.now()>new Date(order.fulfilled_at).getTime()+24*60*60*1000){await client.query('ROLLBACK');return res.status(410).json({error:'24-hour claim window has expired'});}
    const item=await client.query("SELECT id FROM inventory WHERE status='available' ORDER BY id ASC FOR UPDATE SKIP LOCKED LIMIT 1");
    if(!item.rows[0]){await client.query('ROLLBACK');return res.status(409).json({error:'Bonus ID is out of stock'});}
    const inventoryId=item.rows[0].id;
    await client.query("UPDATE inventory SET status='sold',sold_order_id=$1,reserved_order_id=NULL WHERE id=$2",[order.order_id,inventoryId]);
    await client.query('INSERT INTO order_items(order_id,inventory_id) VALUES($1,$2)',[order.order_id,inventoryId]);
    await client.query("UPDATE orders SET claim_used_at=NOW(),claim_status='approved' WHERE order_id=$1",[order.order_id]);
    await client.query('COMMIT');
    const claimed=await q('SELECT i.login_id,i.login_password,i.extra_data FROM inventory i WHERE i.id=$1',[inventoryId]);
    const x=claimed.rows[0];
    res.json({ok:true,message:'Claim approved and 1 ID released',items:[{login_id:decryptSecret(x.login_id),login_password:decryptSecret(x.login_password),extra_data:decryptSecret(x.extra_data)}]});
  }catch(e){try{await client.query('ROLLBACK')}catch{};console.error('Claim approve error:',e);res.status(500).json({error:'Could not approve claim'});}
  finally{client.release();}
});
app.post('/api/admin/orders/:orderId/claim-reject',auth,async(req,res)=>{
  try{
    const r=await q("UPDATE orders SET claim_status='rejected' WHERE order_id=$1 AND claim_status='pending' RETURNING order_id",[req.params.orderId]);
    if(!r.rows[0]) return res.status(400).json({error:'Only pending claim requests can be rejected'});
    res.json({ok:true});
  }catch(e){res.status(500).json({error:'Could not reject claim'});}
});

app.get('/api/order-check/:utr', siteGate, rateLimit(apiHits,60*1000,20), async(req,res)=>{ try{ const utr=String(req.params.utr||'').trim().replace(/\s+/g,''); if(!/^[A-Za-z0-9]{8,35}$/.test(utr)) return res.status(400).json({error:'Invalid UTR / Transaction ID'}); res.json(await getOrderItems(utr)); }catch{res.status(500).json({error:'Server error'});} });

app.get('/admin', (req,res)=>{ res.set('Cache-Control','no-store'); res.sendFile(path.join(__dirname,'public','admin.html')); });

(async()=>{
  try{
    await q(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));
    await migrateOrdersSchema();
    await migrateInventoryEncryption();
    await normalizeStorePrice();
    app.listen(PORT,()=>console.log(`NISHAD BRAND running on ${PORT}`));
  }catch(e){ console.error('Startup DB error:',e); process.exit(1); }
})();
