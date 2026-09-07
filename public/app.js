'use strict';
let config=null, selected=null, pollTimer=null, countdownTimer=null;
const $=id=>document.getElementById(id);
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function money(n){return Number(n||0).toLocaleString('en-IN');}
async function init(){
  try{
    const r=await fetch('/api/config'); config=await r.json(); if(!r.ok) throw new Error(config.error||'Configuration failed');
    $('siteName').textContent=config.siteName||'NISHAD BRAND'; $('logo').src=config.logo||'/logo.png';
    $('wa').href='https://wa.me/'+String(config.whatsapp||'').replace(/\D/g,'');
    const sb=$('stockBanner'); if(sb){ sb.className='stock-banner '+(Number(config.stock||0)>0?'in':'out'); sb.innerHTML=Number(config.stock||0)>0?'✓ STOCK AVAILABLE • '+Number(config.stock)+' ID AVAILABLE':'✕ OUT OF STOCK'; }
    const newsBar=$('newsBar'),newsText=$('newsText');
    if(config.news&&String(config.news).trim()){newsText.textContent=String(config.news);newsBar.classList.remove('hidden');}else newsBar.classList.add('hidden');
    const box=$('packages'),packages=config.packages||[]; box.classList.remove('hidden');
    box.innerHTML=packages.map(p=>{const disabled=!p.available||!p.price;const label=!p.available?'Out of Stock':(!p.price?'Price Not Set':'Buy Now');return '<div class="card"><div class="qty">'+p.qty+' ID</div><div class="stock-mini '+(p.available?'in':'out')+'">'+(p.available?'✓ STOCK AVAILABLE':'✕ OUT OF STOCK')+'</div><div class="price">₹'+money(p.price)+'</div><button class="buy" '+(disabled?'disabled':'')+' onclick="openPay('+p.qty+','+Number(p.price||0)+')">'+label+'</button></div>';}).join('')+
      '<div class="card custom-card"><div class="qty">Custom Quantity</div><div class="stock-mini '+(Number(config.stock||0)>0?'in':'out')+'">'+(Number(config.stock||0)>0?'✓ '+Number(config.stock)+' ID AVAILABLE':'✕ OUT OF STOCK')+'</div><div class="custom-help">₹'+money(config.pricePerId)+' per ID</div><input id="customQty" class="customQty" type="number" min="1" max="'+Number(config.stock||1)+'" value="1" oninput="updateCustomTotal()"><div id="customTotal" class="price">₹'+money(config.pricePerId)+'</div><button class="buy" '+(!config.stock||!config.pricePerId?'disabled':'')+' onclick="buyCustom()">Buy Custom Quantity</button></div>';
    updateCustomTotal();
  }catch(e){$('packages').innerHTML='<div class="error">Store load failed: '+esc(e.message)+'</div>';}
}
function updateCustomTotal(){const el=$('customQty'),total=$('customTotal');if(!el||!total||!config)return;let qty=Math.floor(Number(el.value)||1);qty=Math.max(1,Math.min(Number(config.stock||1),qty));el.value=qty;total.textContent='₹'+money(Number(config.pricePerId||0)*qty);}
function buyCustom(){const qty=Math.floor(Number($('customQty')?.value)||0);if(!qty||qty<1||qty>Number(config.stock||0))return;openPay(qty,Number(config.pricePerId||0)*qty);}
function openPay(qty,price){selected={qty,price};$('qrDownload').classList.add('hidden');$('qrDownload').removeAttribute('href');$('payText').textContent=qty+' ID package — ₹'+money(price);$('qrBox').classList.add('hidden');$('payStatus').textContent='QR तैयार हो रहा है…';$('modal').classList.remove('hidden');startQrPayment();}
function closePay(){stopPolling();$('modal').classList.add('hidden');}
async function startQrPayment(){
  stopPolling();
  try{
    const r=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({qty:selected.qty,name:'',phone:''})});
    const d=await r.json(); if(!r.ok) throw new Error(d.error||'QR create failed');
    $('qrImage').src=d.qrImage; $('qrDownload').href=d.qrImage; $('qrDownload').classList.remove('hidden'); $('upiOpen').href=d.upiLink||'#'; $('upiOpen').classList.toggle('hidden',!d.upiLink); $('payText').textContent=d.quantity+' ID package — ₹'+money(Number(d.amount||selected.price)); $('qrBox').classList.remove('hidden'); $('payStatus').innerHTML='<b>QR ready — ₹'+money(Number(d.amount||selected.price))+'</b><br>QR scan karke payment karein. Payment ke baad UTR / Transaction ID neeche submit karein. Admin approval ke baad ID release hogi.'; $('utrBox').classList.remove('hidden');
    startCountdown(Number(d.expiresAt||Date.now()+300000));
    window.currentOrderId=d.orderId; pollTimer=setInterval(()=>checkQrStatus(d.orderId),3000); await checkQrStatus(d.orderId);
  }catch(e){$('payStatus').innerHTML='<div class="error">'+esc(e.message)+'</div>';}
}
async function submitUTR(){
  const utr=$('utrInput').value.trim();
  if(!utr){$('utrMsg').innerHTML='<div class="error">UTR / Transaction ID डालें.</div>';return;}
  const orderId=window.currentOrderId;
  if(!orderId){$('utrMsg').innerHTML='<div class="error">Order session नहीं मिला. Buy Now फिर से करें.</div>';return;}
  $('utrBtn').disabled=true;$('utrMsg').textContent='Submitting…';
  try{
    const r=await fetch('/api/orders/'+encodeURIComponent(orderId)+'/utr',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({utr})});
    const d=await r.json();
    if(!r.ok) throw new Error(d.error||'UTR submit failed');
    $('utrMsg').innerHTML='<div class="pending"><b>Payment submitted.</b><br>Admin approval pending. Approval ke baad ID yahin milegi.</div>';
    $('utrBtn').disabled=true;
    await checkQrStatus(orderId);
  }catch(e){$('utrMsg').innerHTML='<div class="error">'+esc(e.message)+'</div>';$('utrBtn').disabled=false;}
}
async function checkQrStatus(orderId){
  try{
    const r=await fetch('/api/payment/qr-status/'+encodeURIComponent(orderId),{cache:'no-store'}); const d=await r.json();
    if(!r.ok) throw new Error(d.error||'Verification failed');
    if(d.status==='approved' || d.status==='paid'){stopPolling();showIDs(d.items,d.order);return;}
    if(d.status==='pending_approval'){ $('payStatus').innerHTML='<div class="pending"><b>Payment received ✓</b><br>Admin approval pending. Approval ke baad hi ID release hogi.<br><small>Payment details securely hidden.</small></div>'; return; }
    if(d.status==='expired'){stopPolling();$('payStatus').innerHTML='<div class="error">QR expired. Please click Buy Now again to generate a new QR.</div>';return;}
  }catch(e){console.warn(e);}
}
function startCountdown(expiresAt){clearInterval(countdownTimer);const tick=()=>{const left=Math.max(0,expiresAt-Date.now());const sec=Math.ceil(left/1000);if(sec<=0){$('timer').textContent='00:00';clearInterval(countdownTimer);return;}const m=String(Math.floor(sec/60)).padStart(2,'0'),s=String(sec%60).padStart(2,'0');$('timer').textContent=m+':'+s;};tick();countdownTimer=setInterval(tick,1000);}
function stopPolling(){if(pollTimer)clearInterval(pollTimer);pollTimer=null;if(countdownTimer)clearInterval(countdownTimer);countdownTimer=null;}
function showIDs(items,order){const rows=(items||[]).map((x,i)=>'<div class="idrow"><b>ID '+(i+1)+':</b> <code>'+esc(x.login_id)+'</code>'+(x.login_password?'<br><b>Password:</b> <code>'+esc(x.login_password)+'</code>':'')+(x.extra_data?'<br>'+esc(x.extra_data):'')+'</div>').join('');$('payStatus').innerHTML='<div class="success"><b>Payment verified successfully ✓</b><br>Admin approval complete. Your ID details are below.'+rows+'</div>';}
async function checkUTR(){const u=$('utr').value.trim();if(!u)return;$('result').textContent='Checking…';try{const r=await fetch('/api/order-check/'+encodeURIComponent(u));const d=await r.json();if(!d.found){$('result').innerHTML='<div class="error">Not Found — इस UTR/Payment ID से कोई verified purchase नहीं मिला।</div>';return;}showCheck(d.items,d.order);}catch(e){$('result').innerHTML='<div class="error">'+esc(e.message)+'</div>';}}
function showCheck(items,order){if(order.status==='rejected'){ $('result').innerHTML='<div class="error"><b>Payment Rejected.</b><br>Admin ne is payment ko approve nahi kiya.</div>';return;} if(order.status!=='approved'&&order.status!=='paid'){ $('result').innerHTML='<div class="pending"><b>Payment Pending Approval</b><br>Payment record mil gaya hai, lekin admin approval abhi pending hai.<br>Order: <code>'+esc(order.order_id)+'</code></div>';return;} const rows=(items||[]).map((x,i)=>'<div class="idrow"><b>ID '+(i+1)+':</b> <code>'+esc(x.login_id)+'</code>'+(x.login_password?'<br><b>Password:</b> <code>'+esc(x.login_password)+'</code>':'')+(x.extra_data?'<br>'+esc(x.extra_data):'')+'</div>').join('');$('result').innerHTML='<div class="success"><b>Verified Purchase</b><br>Order: <code>'+esc(order.order_id)+'</code>'+rows+'</div>';}
init();
