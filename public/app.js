'use strict';
let config=null, selected=null, pollTimer=null, countdownTimer=null, storeRefreshTimer=null, storeRefreshBusy=false, turnstileWidgetId=null, siteGateWidgetId=null, siteVerified=false, siteGateBusy=false;
const $=id=>document.getElementById(id);
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function money(n){return Number(n||0).toLocaleString('en-IN');}
function siteGateSiteKey(){ return String(document.querySelector('meta[name="cf-turnstile-site-key"]')?.content||'').trim(); }
function revealSite(){ siteVerified=true; document.body.classList.add('site-verified'); const g=$('siteGate'); if(g) g.classList.add('hidden'); }
async function verifySiteToken(token){
  if(siteGateBusy || !token) return;
  siteGateBusy=true; const msg=$('siteGateMsg'); if(msg) msg.textContent='Verifying…';
  try{
    const r=await fetch('/api/site-verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
    const d=await r.json();
    if(!r.ok) throw new Error(d.error||'Cloudflare verification failed');
    revealSite(); await initStoreAfterGate();
  }catch(e){ if(msg) msg.textContent=String(e.message||'Cloudflare verification failed'); try{if(siteGateWidgetId!==null&&window.turnstile)window.turnstile.reset(siteGateWidgetId);}catch{} }
  finally{siteGateBusy=false;}
}
function initSiteGate(){
  const box=$('siteTurnstile'), key=siteGateSiteKey();
  if(!box || !key) return;
  if(!window.turnstile){ setTimeout(initSiteGate,400); return; }
  if(siteGateWidgetId!==null) return;
  try{ siteGateWidgetId=window.turnstile.render(box,{sitekey:key,theme:'light',appearance:'always',execution:'render',callback:verifySiteToken,'expired-callback':()=>{const m=$('siteGateMsg');if(m)m.textContent='Verification expired. Please verify again.';},'error-callback':()=>{const m=$('siteGateMsg');if(m)m.textContent='Cloudflare verification error. Please try again.';}}); }catch(e){ console.warn('Site Turnstile init:',e); setTimeout(initSiteGate,1000); }
}
async function initStoreAfterGate(){ if(config) return init(); return init(); }

async function refreshStoreStock(){
  if(storeRefreshBusy) return;
  storeRefreshBusy=true;
  try{
    const r=await fetch('/api/config?ts='+Date.now(),{cache:'no-store'});
    if(!r.ok) return;
    const d=await r.json();
    config=d;
    const cb=document.querySelector('.claim-box'); if(cb) cb.classList.toggle('hidden', String(d.bonusOfferEnabled||'true')!=='true');
    const sb=$('stockBanner');
    if(sb){
      sb.className='stock-banner in';
      const realStock=Number(d.stock||0);
      sb.className=realStock>0?'stock-banner in':'stock-banner out empty-stock-notice';
      sb.innerHTML=realStock>0?'✓ ID STOCK AVAILABLE • '+realStock+' ID<span class=\"stock-capacity-indicator\" aria-label=\"Stock level\"><span class=\"stock-capacity-fill\"></span></span>':'<span class=\"out-stock-mark\">×</span><span>OUT OF STOCK</span><span class=\"coming-soon\">MORE ID COMING SOON</span>';
      if(realStock>0){ const fill=sb.querySelector('.stock-capacity-fill'); if(fill) fill.style.width=(Math.max(0,Math.min(10,realStock))/10*100)+'%'; }
      document.querySelector('.store-section')?.classList.toggle('empty-stock', realStock<=0);
      document.body.classList.toggle('stock-empty-mode', realStock<=0);
    }
    const cards=$('packages');
    if(cards && !$('modal')?.classList.contains('hidden')) return;
    if(cards){
      const stock=Number(d.stock||0), price=Number(d.pricePerId||0);
      cards.querySelectorAll('.card:not(.custom-card)').forEach((card)=>{
        const q=Number(card.querySelector('.qty')?.textContent||'').toString();
        const qty=parseInt(q,10);
        const btn=card.querySelector('.buy');
        const mini=card.querySelector('.stock-mini');
        const priceEl=card.querySelector('.price');
        if(!qty || !btn) return;
        const available=stock>=qty && price>0;
        if(mini){mini.className='stock-mini '+(available?'in':'out');mini.textContent=available?'✓ STOCK AVAILABLE':'✕ OUT OF STOCK';}
        if(priceEl) priceEl.textContent='₹'+money(price*qty);
        btn.disabled=!available;
        btn.textContent=available?'Buy Now':(stock<qty?'Out of Stock':'Price Not Set');
        btn.setAttribute('onclick',"openPay("+qty+","+Number(price*qty)+")");
      });
      const custom=$('customQty'), total=$('customTotal');
      if(custom){
        custom.max=String(stock);
        if(stock<=0){custom.value='';}
        else if(Number(custom.value)>stock) custom.value=String(stock);
        updateCustomTotal();
      }
      const customCard=document.querySelector('.custom-card');
      if(customCard){
        const mini=customCard.querySelector('.stock-mini');
        if(mini){mini.className='stock-mini '+(stock>0?'in':'out');mini.textContent=stock>0?'✓ '+stock+' ID AVAILABLE':'✕ OUT OF STOCK';}
        const btn=customCard.querySelector('.buy');
        if(btn) btn.disabled=!(stock>0 && price>0);
      }
    }
  }catch(e){console.warn('Store stock refresh:',e);}
  finally{storeRefreshBusy=false;}
}
function startStoreAutoRefresh(){
  if(storeRefreshTimer) return;
  storeRefreshTimer=setInterval(refreshStoreStock,3000);
}
function initTurnstile(){
  const box=$('turnstileBox');
  if(!box || !config?.turnstileSiteKey) return;
  if(!window.turnstile){
    setTimeout(initTurnstile,500);
    return;
  }
  try{
    if(turnstileWidgetId!==null){
      window.turnstile.reset(turnstileWidgetId);
      return;
    }
    turnstileWidgetId=window.turnstile.render(box,{
      sitekey:config.turnstileSiteKey,
      theme:'dark',
      appearance:'always',
      execution:'render',
      callback:()=>{},
      'expired-callback':()=>{},
      'error-callback':()=>{}
    });
  }catch(e){console.warn('Turnstile init:',e);setTimeout(initTurnstile,1000);}
}
function getTurnstileToken(){
  try{return (turnstileWidgetId!==null && window.turnstile)?String(window.turnstile.getResponse(turnstileWidgetId)||''):'';}catch{return '';}
}
function resetTurnstile(){try{if(turnstileWidgetId!==null&&window.turnstile)window.turnstile.reset(turnstileWidgetId);}catch{}}

function updateBonusCopy(){
  const qty=Math.max(1,Math.min(100000,parseInt(config?.bonusPurchaseQty,10)||10));
  const title=$('claimTitle'), desc=$('claimDescription');
  if(title) title.textContent='🎁 '+qty+' ID Purchase Bonus';
  if(desc) desc.innerHTML=qty+' ID खरीदने पर उसी UTR से <b>1 extra ID claim</b> करें। Claim केवल <b>1 बार</b> और payment approval के <b>24 घंटे के अंदर</b> होगा।';
}
async function init(){
  if(!siteVerified){ initSiteGate(); return; }
  try{
    const r=await fetch('/api/config?ts='+Date.now(),{cache:'no-store'}); config=await r.json(); updateBonusCopy(); const cb=document.querySelector('.claim-box'); if(cb) cb.classList.toggle('hidden', String(config.bonusOfferEnabled||'true')!=='true'); if(!r.ok) throw new Error(config.error||'Configuration failed');
    $('siteName').textContent=config.siteName||'NISHAD BRAND'; $('logo').src=config.logo||'/logo.png';
    $('wa').href='https://wa.me/'+String(config.whatsapp||'').replace(/\D/g,'');
    const sb=$('stockBanner'); if(sb){ const realStock=Number(config.stock||0); sb.className=realStock>0?'stock-banner in':'stock-banner out empty-stock-notice'; sb.innerHTML=realStock>0?'✓ ID STOCK AVAILABLE • '+realStock+' ID<span class=\"stock-capacity-indicator\" aria-label=\"Stock level\"><span class=\"stock-capacity-fill\"></span></span>':'<span class=\"out-stock-mark\">×</span><span>OUT OF STOCK</span><span class=\"coming-soon\">MORE ID COMING SOON</span>';
      if(realStock>0){ const fill=sb.querySelector('.stock-capacity-fill'); if(fill) fill.style.width=(Math.max(0,Math.min(10,realStock))/10*100)+'%'; } document.querySelector('.store-section')?.classList.toggle('empty-stock', realStock<=0); document.body.classList.toggle('stock-empty-mode', realStock<=0); }
    const newsBar=$('newsBar'),newsText=$('newsText');
    if(config.news&&String(config.news).trim()){newsText.textContent=String(config.news);newsBar.classList.remove('hidden');}else newsBar.classList.add('hidden');
    const box=$('packages'),packages=config.packages||[]; box.classList.remove('hidden');
    box.innerHTML=Number(config.stock||0)<=0?'':packages.map(p=>{const disabled=!p.available||!p.price;const label=!p.available?'Out of Stock':(!p.price?'Price Not Set':'Buy Now');const pricing=p.discount>0?'<div class="price"><span class="old-price">₹'+money(p.originalPrice)+'</span> <span>₹'+money(p.price)+'</span></div><div class="save-text">Save ₹'+money(p.discount)+'</div>':'<div class="price">₹'+money(p.price)+'</div>';return '<div class="card"><div class="qty">'+p.qty+' ID</div><div class="stock-mini '+(p.available?'in':'out')+'">'+(p.available?'✓ STOCK AVAILABLE':'✕ OUT OF STOCK')+'</div>'+pricing+'<button class="buy" '+(disabled?'disabled':'')+' onclick="openPay('+p.qty+','+Number(p.price||0)+')">'+label+'</button></div>';}).join('')+
      (Number(config.stock||0)<=0?'':'<div class="card custom-card"><div class="qty">Custom Quantity</div><div class="stock-mini '+(Number(config.stock||0)>0?'in':'out')+'">'+(Number(config.stock||0)>0?'✓ '+Number(config.stock)+' ID AVAILABLE':'✕ OUT OF STOCK')+'</div><div class="custom-help">₹'+money(config.pricePerId)+' per ID • Enter how many IDs you need</div><div class="custom-row"><input id="customQty" class="customQty" type="number" min="1" max="'+Number(config.stock||0)+'" value="1" inputmode="numeric" oninput="updateCustomTotal()" onblur="normalizeCustomQty()"><div id="customTotal" class="price">₹'+money(config.pricePerId)+'</div></div><button class="buy" '+(!config.stock||!config.pricePerId?'disabled':'')+' onclick="buyCustom()">Buy Custom Quantity</button></div>'); 
    updateCustomTotal();
    startStoreAutoRefresh();
  }catch(e){$('packages').innerHTML='<div class="error">Store load failed: '+esc(e.message)+'</div>';}
}
function updateCustomTotal(){const el=$('customQty'),total=$('customTotal');if(!el||!total||!config)return;const raw=String(el.value||'').trim();if(!raw){total.textContent='₹0';return;}let qty=Math.floor(Number(raw));if(!Number.isFinite(qty)||qty<1){total.textContent='₹0';return;}const stock=Number(config.stock||0);if(stock>0&&qty>stock){total.textContent='₹'+money(Number(config.pricePerId||0)*stock)+' (max '+stock+')';return;}total.textContent='₹'+money(Number(config.pricePerId||0)*qty);}
function normalizeCustomQty(){const el=$('customQty');if(!el||!config)return;const stock=Number(config.stock||0);let qty=Math.floor(Number(el.value)||0);if(stock<=0){el.value='';$('customTotal').textContent='₹0';return;}qty=Math.max(1,Math.min(stock,qty||1));el.value=qty;updateCustomTotal();}
function buyCustom(){const el=$('customQty');const qty=Math.floor(Number(el?.value)||0);const stock=Number(config?.stock||0);if(!qty||qty<1||qty>stock)return;openPay(qty,Number(config.pricePerId||0)*qty);}
function openPay(qty,price){price=Number(price||0);selected={qty,price};$('qrDownload').classList.add('hidden');$('qrDownload').removeAttribute('href');$('payText').textContent=qty+' ID package — ₹'+money(price);$('qrBox').classList.add('hidden');$('payStatus').textContent='QR तैयार हो रहा है…';$('modal').classList.remove('hidden');startQrPayment();}
function closePay(){stopPolling();window.currentOrderId='';window.currentOrderToken='';$('modal').classList.add('hidden');}
async function startQrPayment(){
  stopPolling();
  try{
    const r=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({qty:selected.qty,name:'',phone:''})});
    const d=await r.json(); if(!r.ok) throw new Error(d.error||'QR create failed');
    $('qrImage').src=d.qrImage; $('qrDownload').href=d.qrImage; $('qrDownload').classList.remove('hidden'); $('upiOpen').href=d.upiLink||'#'; $('upiOpen').classList.toggle('hidden',!d.upiLink); $('payText').textContent=d.quantity+' ID — ₹'+money(Number(d.amount!=null?d.amount/100:selected.price||0)); $('qrBox').classList.remove('hidden'); $('payStatus').innerHTML='<b>QR ready — ₹'+money(Number(d.amount||0)/100)+'</b><br>QR scan karke payment karein. Payment ke baad UTR / Transaction ID neeche submit karein. Payment approval ke baad ID release hogi.'; $('utrBox').classList.remove('hidden'); setTimeout(initTurnstile,0);
    startCountdown(Number(d.expiresAt||Date.now()+300000));
    window.currentOrderId=d.orderId; window.currentOrderToken=d.orderToken||''; pollTimer=setInterval(()=>checkQrStatus(d.orderId),3000); await checkQrStatus(d.orderId);
  }catch(e){$('payStatus').innerHTML='<div class="error">'+esc(e.message)+'</div>';}
}
async function submitUTR(){
  const utr=$('utrInput').value.trim();
  if(!/^[A-Za-z0-9]{8,35}$/.test(utr)){$('utrMsg').innerHTML='<div class="error">UTR / Transaction ID 8–35 letters/digits का होना चाहिए.</div>';return;}
  const orderId=window.currentOrderId;
  if(!orderId){$('utrMsg').innerHTML='<div class="error">Order session नहीं मिला. Buy Now फिर से करें.</div>';return;}
  $('utrBtn').disabled=true;$('utrMsg').textContent='Submitting…';
  try{
    const r=await fetch('/api/orders/'+encodeURIComponent(orderId)+'/utr',{method:'POST',headers:{'Content-Type':'application/json','X-Order-Token':String(window.currentOrderToken||'')},body:JSON.stringify({utr,turnstileToken:getTurnstileToken()})});
    const d=await r.json();
    if(!r.ok) throw new Error(d.error||'UTR submit failed');
    $('utrMsg').innerHTML='<div class="pending"><b>Payment submitted.</b><br>Admin approval pending. Approval ke baad ID yahin milegi.</div>';
    $('utrBtn').disabled=true;
    resetTurnstile();
    await checkQrStatus(orderId);
  }catch(e){$('utrMsg').innerHTML='<div class="error">'+esc(e.message)+'</div>';$('utrBtn').disabled=false;resetTurnstile();}
}
async function checkQrStatus(orderId){
  try{
    const r=await fetch('/api/payment/qr-status/'+encodeURIComponent(orderId),{cache:'no-store',headers:{'X-Order-Token':String(window.currentOrderToken||'')}}); const d=await r.json();
    if(!r.ok) throw new Error(d.error||'Verification failed');
    if(d.status==='approved' || d.status==='paid'){stopPolling();$('utrMsg').innerHTML='<div class="success"><b>✅ PAYMENT APPROVED</b><br>Aapki payment approve ho gayi hai. Neeche ID delivery ho gayi hai.</div>';showIDs(d.items,d.order);return;}
    if(d.status==='pending_approval'){ $('payStatus').innerHTML='<div class="pending"><b>Payment received ✓</b><br>Admin approval pending. Approval ke baad hi ID release hogi.<br><small>Payment details securely hidden.</small></div>'; return; }
    if(d.status==='rejected'){ stopPolling(); const msg='<div class="error">Your UTR / Transaction ID was rejected.</div>'; $('payStatus').innerHTML=msg; $('utrMsg').innerHTML=msg; return; }if(d.status==='expired'){stopPolling();$('payStatus').innerHTML='<div class="error">QR expired. Please click Buy Now again to generate a new QR.</div>';return;}
  }catch(e){console.warn(e);}
}
function startCountdown(expiresAt){clearInterval(countdownTimer);const tick=()=>{const left=Math.max(0,expiresAt-Date.now());const sec=Math.ceil(left/1000);if(sec<=0){$('timer').textContent='00:00';clearInterval(countdownTimer);return;}const m=String(Math.floor(sec/60)).padStart(2,'0'),s=String(sec%60).padStart(2,'0');$('timer').textContent=m+':'+s;};tick();countdownTimer=setInterval(tick,1000);}
function stopPolling(){if(pollTimer)clearInterval(pollTimer);pollTimer=null;if(countdownTimer)clearInterval(countdownTimer);countdownTimer=null;}
function copyCredential(value,btn){const text=String(value??'');if(!text)return;const done=()=>{if(btn){const old=btn.textContent;btn.textContent='✓ Copied';btn.classList.add('copied');setTimeout(()=>{btn.textContent=old;btn.classList.remove('copied');},1400);}};if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(text).then(done).catch(()=>fallbackCopy(text,done));}else{fallbackCopy(text,done);}}
function fallbackCopy(text,done){const ta=document.createElement('textarea');ta.value=text;ta.setAttribute('readonly','');ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');done();}finally{ta.remove();}}
function copyButton(value,label){const safe=JSON.stringify(String(value??'')).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');return '<button type="button" class="copy-cred" onclick="copyCredential('+safe+',this)">'+label+'</button>';}
function copyAllCredentials(items,btn){const list=(items||[]);if(!list.length)return;const text=list.map((x,i)=>{const parts=['ID '+(i+1)+': '+String(x.login_id??'')];if(x.login_password)parts.push('Password: '+String(x.login_password));if(x.extra_data)parts.push(String(x.extra_data));return parts.join('\n');}).join('\n\n');copyCredential(text,btn);}
function copyAllButton(items,label='📋 Copy All'){const encoded=JSON.stringify(items||[]).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');return '<button type="button" class="copy-all-cred" onclick="copyAllCredentials('+encoded+',this)">'+label+'</button>';}
function credentialRows(items,prefix){return (items||[]).map((x,i)=>'<div class="idrow"><div class="cred-line"><b>'+prefix+(i+1)+':</b> <code>'+esc(x.login_id)+'</code>'+copyButton(x.login_id,'📋 Copy ID')+'</div>'+(x.login_password?'<div class="cred-line"><b>Password:</b> <code>'+esc(x.login_password)+'</code>'+copyButton(x.login_password,'📋 Copy Password')+'</div>':'')+(x.extra_data?'<div class="cred-extra">'+esc(x.extra_data)+'</div>':'')+'</div>').join('');}
function showIDs(items,order){const rows=credentialRows(items,'ID ');$('payStatus').innerHTML='<div class="success"><b>✅ PAYMENT APPROVED — ID DELIVERY SUCCESSFUL</b><br>Admin approval ho gaya hai. Aapki ID neeche delivery ho gayi hai. ID aur Password yahin se mil jayega.<div class="copy-all-wrap">'+copyAllButton(items,'📋 Copy All IDs & Passwords')+'</div>'+rows+'</div>';}

async function claimBonus(){
  const el=$('claimUtr'), out=$('claimResult');
  const utr=String(el?.value||'').trim().replace(/\s+/g,'');
  if(!/^[A-Za-z0-9]{8,35}$/.test(utr)){out.innerHTML='<div class="error">Valid UTR / Transaction ID डालें.</div>';return;}
  out.textContent='Claim checking…';
  try{
    const r=await fetch('/api/claim-bonus/'+encodeURIComponent(utr),{method:'POST',headers:{'Content-Type':'application/json'}});
    const d=await r.json();
    if(!r.ok) throw new Error(d.error||'Claim failed');
    const rows=(d.items||[]).map((x)=>'<div class="idrow"><div class="cred-line"><b>🎁 Bonus ID:</b> <code>'+esc(x.login_id)+'</code>'+copyButton(x.login_id,'📋 Copy ID')+'</div>'+(x.login_password?'<div class="cred-line"><b>Password:</b> <code>'+esc(x.login_password)+'</code>'+copyButton(x.login_password,'📋 Copy Password')+'</div>':'')+(x.extra_data?'<div class="cred-extra">'+esc(x.extra_data)+'</div>':'')+'</div>').join('');
    out.innerHTML='<div class="success"><b>🎁 1 ID CLAIM SUCCESSFUL ✓</b><br>Bonus ID aur password neeche diya gaya hai. Yeh UTR dobara bonus claim nahi kar sakta.<div class="copy-all-wrap">'+copyAllButton(d.items,'📋 Copy All IDs & Passwords')+'</div>'+rows+'</div>';
  }catch(e){out.innerHTML='<div class="error">'+esc(e.message)+'</div>';}
}
async function checkUTR(){const u=$('utr').value.trim();if(!/^[A-Za-z0-9]{8,35}$/.test(u)){$('result').innerHTML='<div class="error">Valid UTR / Transaction ID डालें (8–35 letters/digits).</div>';return;}$('result').textContent='Checking…';try{const r=await fetch('/api/order-check/'+encodeURIComponent(u));const d=await r.json();if(!d.found){$('result').innerHTML='<div class="error">Not Found — इस UTR/Payment ID से कोई verified purchase नहीं मिला।</div>';return;}showCheck(d.items,d.order);}catch(e){$('result').innerHTML='<div class="error">'+esc(e.message)+'</div>';}}
function showCheck(items,order){if(order.status==='rejected'){ $('result').innerHTML='<div class="error">Your UTR / Transaction ID was rejected.</div>';return;} if(order.status!=='approved'&&order.status!=='paid'){ $('result').innerHTML='<div class="pending"><b>Payment Pending Approval</b><br>Payment record mil gaya hai, lekin admin approval abhi pending hai.<br>Order: <code>'+esc(order.order_id)+'</code></div>';return;} const rows=credentialRows(items,'ID ');$('result').innerHTML='<div class="success"><b>Verified Purchase</b><br>Order: <code>'+esc(order.order_id)+'</code><div class="copy-all-wrap">'+copyAllButton(items,'📋 Copy All IDs & Passwords')+'</div>'+rows+'</div>'; }


// Start the site-wide Cloudflare gate as soon as the page DOM is ready.
document.addEventListener('DOMContentLoaded',()=>{
  init();
});



// V44.61: top-corner Manage menu
function toggleManageMenu(){
  const m=document.getElementById('manageMenu'), b=document.getElementById('manageBtn');
  if(!m) return;
  const hidden=m.classList.toggle('hidden');
  if(b) b.setAttribute('aria-expanded',String(!hidden));
}
function openManageSection(id){
  const el=document.getElementById(id);
  const m=document.getElementById('manageMenu'), b=document.getElementById('manageBtn');
  if(m) m.classList.add('hidden');
  if(b) b.setAttribute('aria-expanded','false');
  if(el) el.scrollIntoView({behavior:'smooth',block:'start'});
}
document.addEventListener('click',function(e){
  const a=document.querySelector('.header-actions');
  const m=document.getElementById('manageMenu');
  const b=document.getElementById('manageBtn');
  if(a && m && !a.contains(e.target)){m.classList.add('hidden');if(b)b.setAttribute('aria-expanded','false');}
});
