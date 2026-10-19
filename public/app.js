'use strict';
let config=null, selected=null, pollTimer=null, countdownTimer=null, storeRefreshTimer=null, storeRefreshBusy=false, turnstileWidgetId=null;
const $=id=>document.getElementById(id);
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function money(n){return Number(n||0).toLocaleString('en-IN');}
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
      callback:async(token)=>{
        // The UTR endpoint can verify this token itself, but we also establish
        // the server-side gate immediately after Turnstile reports success.
        try{
          await fetch('/api/site-verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
        }catch(e){console.warn('Cloudflare gate:',e);}
      },
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
    $('qrImage').src=d.qrImage; $('qrDownload').href=d.qrImage; $('qrDownload').classList.remove('hidden'); $('upiOpen').href=d.upiLink||'#'; $('upiOpen').classList.toggle('hidden',!d.upiLink); $('payText').textContent=d.quantity+' ID — ₹'+money(Number(d.amount!=null?d.amount/100:selected.price||0)); $('qrBox').classList.remove('hidden'); $('payStatus').innerHTML=''; $('utrBox').classList.remove('hidden'); setTimeout(initTurnstile,0);
    startCountdown(Number(d.expiresAt||Date.now()+300000));
    window.currentOrderId=d.orderId; window.currentOrderToken=d.orderToken||''; pollTimer=setInterval(()=>checkQrStatus(d.orderId),3000); await checkQrStatus(d.orderId);
  }catch(e){$('payStatus').innerHTML='<div class="error">'+esc(e.message)+'</div>';}
}
async function submitUTR(){
  const utr=$('utrInput').value.trim();
  window.lastSubmittedUtr=utr;
  if(!/^[A-Za-z0-9]{8,35}$/.test(utr)){$('utrMsg').innerHTML='<div class="error">UTR / Transaction ID 8–35 letters/digits का होना चाहिए.</div>';return;}
  const orderId=window.currentOrderId;
  if(!orderId){$('utrMsg').innerHTML='<div class="error">Order session नहीं मिला. Buy Now फिर से करें.</div>';return;}
  $('utrBtn').disabled=true;$('utrMsg').textContent='Submitting…';
  try{
    const r=await fetch('/api/orders/'+encodeURIComponent(orderId)+'/utr',{method:'POST',headers:{'Content-Type':'application/json','X-Order-Token':String(window.currentOrderToken||'')},body:JSON.stringify({utr,turnstileToken:getTurnstileToken()})});
    const d=await r.json();
    if(!r.ok) throw new Error(d.error||'UTR submit failed');
    $('utrMsg').innerHTML='<div class="payment-processing"><span class="payment-spinner" aria-hidden="true"></span><div><b>Payment Processing...</b><br><small>Payment verify ho raha hai. Please wait.</small></div></div>';
    $('payStatus').innerHTML='<div class="payment-processing"><span class="payment-spinner" aria-hidden="true"></span><div><b>Payment Processing...</b><br><small>Please wait...</small></div></div>';
    $('utrBtn').disabled=true;
    resetTurnstile();
    await checkQrStatus(orderId);
  }catch(e){$('utrMsg').innerHTML='<div class="error">'+esc(e.message)+'</div>';$('utrBtn').disabled=false;resetTurnstile();}
}
async function checkQrStatus(orderId){
  try{
    const r=await fetch('/api/payment/qr-status/'+encodeURIComponent(orderId),{cache:'no-store',headers:{'X-Order-Token':String(window.currentOrderToken||'')}}); const d=await r.json();
    if(!r.ok) throw new Error(d.error||'Verification failed');
     if(d.status==='approved' || d.status==='paid'){
       stopPolling();
       // After verified approval, send the customer to Find ID. They can
       // submit the same UTR there to retrieve only their approved purchase.
       const approvedUtr=String(window.lastSubmittedUtr||'').trim();
       closePay();
       openManageSection('utrCheckSection');
       if(approvedUtr){
         $('utr').value=approvedUtr;
         $('result').innerHTML='<div class="success"><b>✅ Payment Approved</b><br>अब Find ID बटन दबाएँ। आपकी खरीदी हुई ID और Password नीचे दिखाई देंगे।</div>';
       } else {
         $('result').innerHTML='<div class="success"><b>✅ Payment Approved</b><br>अपना UTR डालकर Fetch IDs दबाएँ।</div>';
       }
       return;
     }
     if(d.status==='pending_approval'){ $('payStatus').innerHTML='<div class="payment-processing"><span class="payment-spinner" aria-hidden="true"></span><div><b>Payment Processing...</b><br><small>Please wait...</small></div></div>'; $('utrMsg').innerHTML='<div class="payment-processing"><span class="payment-spinner" aria-hidden="true"></span><div><b>Payment Processing...</b><br><small>Payment verify ho raha hai. Please wait.</small></div></div>'; return; }
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
function showIDs(items,order){
  const list=Array.isArray(items)?items:[];
  const rows=credentialRows(list,'ID ');
  const empty=list.length===0;
  // Keep the result in the visible UTR area. The legacy #payStatus element is
  // intentionally hidden by the current stylesheet, so rendering credentials
  // there makes Payment Success appear without the ID/password.
  $('utrMsg').innerHTML='<div class="success payment-success-result"><b>✅ Payment Success</b>'+(!empty?'<div class="copy-all-wrap">'+copyAllButton(list,'📋 Copy All IDs & Passwords')+'</div>'+rows:'<div class="pending" style="margin-top:10px">ID/Password loading…</div>')+'</div>';
  $('payStatus').innerHTML='';
  const box=document.querySelector('.qr-box');
  if(box){
    requestAnimationFrame(()=>{
      box.scrollTop=box.scrollHeight;
      setTimeout(()=>{box.scrollTop=box.scrollHeight;},120);
    });
  }
}

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
function downloadAllCredentials(items){
  const list=Array.isArray(items)?items:[];
  const text=list.map((x,i)=>'ID '+(i+1)+': '+String(x.login_id??'')+(x.login_password?'\nPassword: '+String(x.login_password):'')+(x.extra_data?'\n'+String(x.extra_data):'')).join('\n\n');
  const blob=new Blob([text],{type:'text/plain;charset=utf-8'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');
  a.href=url;a.download='NISHAD-BRAND-Credentials.txt';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}
function compactCredentialRows(items){return (items||[]).map((x)=>{const pair=String(x.login_id??'')+(x.login_password?':'+String(x.login_password):'');return '<div class="idrow"><div class="cred-line"><code>'+esc(pair)+'</code>'+copyButton(pair,'📋 Copy')+'</div>'+(x.extra_data?'<div class="cred-extra">'+esc(x.extra_data)+'</div>':'')+'</div>';}).join('');}
function showCheck(items,order){if(order.status==='rejected'){ $('result').innerHTML='<div class="error">Your UTR / Transaction ID was rejected.</div>';return;} if(order.status!=='approved'&&order.status!=='paid'){ $('result').innerHTML='<div class="pending"><b>Payment Pending Approval</b><br>Payment record mil gaya hai, lekin admin approval abhi pending hai.<br>Order: <code>'+esc(order.order_id)+'</code></div>';return;} const rows=compactCredentialRows(items);$('result').innerHTML='<div class="success find-credentials-result"><b class="find-credentials-title">Verified Purchase</b><div class="credentials-terminal">'+rows+'</div><div class="credentials-actions">'+copyAllButton(items,'▣ Copy All Credentials')+'<button type="button" class="download-credentials" onclick="downloadAllCredentials('+JSON.stringify(items||[]).replace(/</g,'\\u003c').replace(/>/g,'\\u003e')+')">⇩ Download as TXT</button></div></div>'; }


// Start the site-wide Cloudflare gate as soon as the page DOM is ready.
document.addEventListener('DOMContentLoaded',()=>{
  init();
});



// V44.69: animated Find ID and Bonus panels
function openManageSection(id){
  const target=document.getElementById(id);
  if(!target) return;
  const alreadyOpen=target.classList.contains('active');
  document.querySelectorAll('.manage-panel').forEach(panel=>{
    panel.classList.toggle('active',!alreadyOpen && panel===target);
    panel.setAttribute('aria-hidden',String(alreadyOpen || panel!==target));
  });
  // Show only the requested Find ID / Bonus panel; hide the ID purchase cards.
  document.body.classList.toggle('manage-view',!alreadyOpen);
  document.getElementById('findIdBtn')?.classList.toggle('is-selected',!alreadyOpen && id==='utrCheckSection');
  document.getElementById('bonusBtn')?.classList.toggle('is-selected',!alreadyOpen && id==='bonusClaimSection');
  if(alreadyOpen){
    document.getElementById('store')?.scrollIntoView({behavior:'smooth',block:'start'});
    return;
  }
  target.scrollIntoView({behavior:'smooth',block:'center'});
  target.classList.remove('panel-replay');
  void target.offsetWidth;
  target.classList.add('panel-replay');
  const input=target.querySelector('input');
  window.setTimeout(()=>input?.focus({preventScroll:true}),260);
}
