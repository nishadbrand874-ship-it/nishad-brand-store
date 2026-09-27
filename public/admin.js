'use strict';
let ordersRefreshTimer=null;
let ordersRefreshBusy=false;
let paymentAlertBusy=false;
let paymentAlertReady=false;
let knownPaymentRequestIds=new Set();
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
function toggleMenu(){$('menu').classList.toggle('hidden')}
function showSection(id){document.querySelectorAll('.section').forEach(x=>x.classList.add('hidden'));$(id).classList.remove('hidden');$('menu').classList.add('hidden');window.scrollTo({top:0,behavior:'smooth'});}
async function login(){const r=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('user').value,password:$('pass').value})});const d=await r.json();if(r.ok){$('login').classList.add('hidden');$('panel').classList.remove('hidden');load();startOrdersAutoRefresh();}else $('msg').textContent=d.error||'Login failed';}
async function logout(){
  // Logout in one click: stop client activity immediately, clear the server cookie,
  // then replace the page so the login screen is shown without requiring a second click.
  try{
    if(ordersRefreshTimer){clearInterval(ordersRefreshTimer);ordersRefreshTimer=null;}
    if(voiceRecognition){try{voiceRecognition.stop();}catch(e){}}
    voiceControlOn=false;
    try{window.speechSynthesis?.cancel?.();}catch(e){}
    document.querySelectorAll('#menu button').forEach(b=>{
      if(/logout/i.test(b.textContent||'')){b.disabled=true;b.textContent='↪ Logging out...';}
    });
    await fetch('/api/admin/logout',{method:'POST',credentials:'same-origin',cache:'no-store'});
  }catch(e){
    console.warn('Logout request:',e);
  }finally{
    location.replace('/admin.html');
  }
}

let voiceRecognition=null;
let voiceControlOn=false;
let latestPaymentRequestId=null;
let voicePendingOrders=[];
let voiceCommandBusy=false;
let voiceRestartTimer=null;
function speakVoiceReply(text){
  try{
    const u=new SpeechSynthesisUtterance(text);
    u.lang='hi-IN'; u.rate=0.92; u.pitch=1.12; u.volume=1;
    const voices=window.speechSynthesis?.getVoices?.()||[];
    const hi=voices.find(v=>/^hi(-|_)?IN/i.test(v.lang||''))||voices.find(v=>/hindi/i.test(v.name||''));
    if(hi) u.voice=hi;
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
  }catch(e){console.warn('Voice reply:',e);}
}
function setVoiceStatus(on,msg){
  const b=$('voiceBtn'), st=$('voiceStatus');
  if(b) b.textContent=on?'🎙 VOICE CONTROL ON':'🎙 VOICE CONTROL OFF';
  if(st) st.textContent=msg|| (on?'Sun raha hoon...':'Voice control band hai');
}
function normalizeVoiceText(v){
  return String(v||'').toLowerCase().replace(/[.,!?;:]/g,' ').replace(/\s+/g,' ').trim();
}
function normalizeVoiceUtr(v){
  return String(v||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
}
function findVoiceTarget(t){
  const pending=(voicePendingOrders||[]).filter(r=>r.status==='payment_received');
  if(!pending.length) return null;

  // If a new payment alert already selected the newest request, use that exact order.
  if(latestPaymentRequestId){
    const selected=pending.find(r=>String(r.order_id)===String(latestPaymentRequestId));
    if(selected && !/\b(utr|u\s*t\s*r)\b\s*[:#-]?\s*[a-z0-9]{6,35}/i.test(t)) return selected;
  }

  const lastPattern=/\b(last|latest)\b\s*(utr|u\s*t\s*r|request)\b|\b(utr|u\s*t\s*r)\b.*\b(last|latest)\b|\b(last|latest)\s*(payment|request)\b|लास्ट\s*(यूटीआर|यूटीर|रिक्वेस्ट|पेमेंट)|आखिरी\s*(यूटीआर|यूटीर|रिक्वेस्ट|पेमेंट)/i;
  if(lastPattern.test(t) || /lastutr|lastrequest|latestutr|latestrequest/.test(t)) return pending[0];

  // Explicit UTR/order target, including spaces that speech recognition may insert.
  const m=t.match(/(?:utr|u\s*t\s*r|यूटीआर|यूटीर)(?:\s*(?:number|no|no\.|id|नंबर|नं|आईडी))?\s*[:#-]?\s*([a-z0-9][a-z0-9\s-]{3,40})/i);
  if(m){
    const wanted=normalizeVoiceUtr(m[1]);
    if(wanted){
      const exact=pending.find(r=>normalizeVoiceUtr(r.utr||r.payment_id)===wanted);
      if(exact) return exact;
    }
  }

  const candidates=t.match(/\b[a-z0-9]{6,35}\b/gi)||[];
  for(const c of candidates){
    const wanted=normalizeVoiceUtr(c);
    const exact=pending.find(r=>normalizeVoiceUtr(r.utr||r.payment_id)===wanted);
    if(exact) return exact;
  }
  return pending[0];
}
function commandHasWord(t,words){return words.some(x=>new RegExp('(^|\\s)'+x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?=\\s|$)','i').test(t));}
async function handleVoiceCommand(raw){
  const t=normalizeVoiceText(raw);
  if(voiceCommandBusy || !t) return;
  const approveWords=['approve','approved','aproov','aprove','approv','approvee','approve kar','approve kr','approve kardo','approve kar do','अप्रूव','अप्रुव','अप्रूव कर','अप्रूव कर दो','अनुमोदित','मंजूर','मंज़ूर','स्वीकृत'];
  const rejectWords=['reject','rejected','rejact','rejecte','cancel','canceled','cancelled','reject kar','reject kr','reject kardo','reject kar do','cancel kar','cancel kr','cancel kardo','रिजेक्ट','रिजेक्टेड','रिजेक्ट कर','रिजेक्ट कर दो','रद्द','कैंसल','कैंसिल','निरस्त'];
  const hasApprove=commandHasWord(t,approveWords)||/approve|aprov|apruv|अप्रूव|अप्रुव|मंजूर/.test(t);
  const hasReject=commandHasWord(t,rejectWords)||/reject|rejact|cancel|रिजेक्ट|रद्द|कैंसल|कैंसिल/.test(t);
  if(!hasApprove && !hasReject) return;
  if(hasApprove && hasReject){ speakVoiceReply('बॉस, approve या reject में से एक command बोलिए।'); return; }
  const target=findVoiceTarget(t);
  if(!target){
    setVoiceStatus(true,'कोई pending payment request नहीं है');
    speakVoiceReply('ठीक है बॉस, अभी कोई pending payment request नहीं है।');
    return;
  }
  voiceCommandBusy=true;
  const id=String(target.order_id);
  const action=hasReject?'reject':'approve';
  setVoiceStatus(true,'Processing: '+action.toUpperCase()+' '+id);
  try{
    const r=await fetch('/api/admin/orders/'+encodeURIComponent(id)+'/'+action,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest','X-Voice-Command':'1'}});
    const d=await r.json().catch(()=>({}));
    if(r.ok){
      latestPaymentRequestId=null;
      voicePendingOrders=voicePendingOrders.filter(x=>String(x.order_id)!==id);
      if(action==='approve') speakVoiceReply('ठीक है बॉस, request approve कर दी गई है और ID release हो गई है।');
      else speakVoiceReply('ठीक है बॉस, request reject कर दी गई है।');
      setVoiceStatus(true,'Command successful — '+action.toUpperCase());
      await load();
    }else{
      setVoiceStatus(true,'Voice action failed: '+(d.error||'server error'));
      speakVoiceReply('बॉस, request पर action नहीं हो पाया।');
      console.warn('Voice action failed',r.status,d);
    }
  }catch(e){
    setVoiceStatus(true,'Voice action network error');
    speakVoiceReply('बॉस, request पर action नहीं हो पाया।');
    console.warn('Voice action:',e);
  }finally{voiceCommandBusy=false;}
}
function startVoiceControl(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){setVoiceStatus(false,'इस browser में voice command support नहीं है — Chrome/Edge इस्तेमाल करें');return;}
  if(voiceControlOn) return;
  voiceControlOn=true;
  voiceRecognition=new SR();
  voiceRecognition.lang='hi-IN';
  voiceRecognition.continuous=true;
  voiceRecognition.interimResults=false;
  voiceRecognition.maxAlternatives=5;
  voiceRecognition.onstart=()=>setVoiceStatus(true,'🎙 Sun raha hoon — “approve kar do” बोलें');
  voiceRecognition.onresult=e=>{
    for(let i=e.resultIndex;i<e.results.length;i++) if(e.results[i].isFinal){
      const text=e.results[i][0]?.transcript||'';
      console.log('[NISHAD VOICE]',text);
      setVoiceStatus(true,'सुना: '+text);
      handleVoiceCommand(text);
    }
  };
  voiceRecognition.onerror=e=>{
    console.warn('Voice recognition:',e.error);
    if(e.error==='not-allowed'||e.error==='service-not-allowed'){
      voiceControlOn=false;
      setVoiceStatus(false,'Microphone permission Allow करें, फिर Voice Control ON करें');
    }else if(e.error==='audio-capture'){
      setVoiceStatus(true,'Microphone उपलब्ध नहीं है — mic check करें');
    }else if(e.error==='network'){
      setVoiceStatus(true,'Voice service network error — फिर से सुनने की कोशिश हो रही है');
    }else if(e.error==='aborted'){
      setVoiceStatus(true,'Voice restart हो रहा है…');
    }
  };
  voiceRecognition.onend=()=>{
    if(!voiceControlOn) return;
    clearTimeout(voiceRestartTimer);
    voiceRestartTimer=setTimeout(()=>{
      if(!voiceControlOn || !voiceRecognition) return;
      try{voiceRecognition.start();}catch(e){console.warn('Voice restart:',e);}
    },350);
  };
  try{
    voiceRecognition.start();
    setVoiceStatus(true,'🎙 Sun raha hoon — “approve kar do”, “request reject/cancel kar do”, “last UTR approve/reject kar do” बोलें');
  }catch(e){voiceControlOn=false;setVoiceStatus(false,'Voice start नहीं हो पाया — microphone Allow करें');}
}
function stopVoiceControl(){
  voiceControlOn=false;
  clearTimeout(voiceRestartTimer); voiceRestartTimer=null;
  if(voiceRecognition){try{voiceRecognition.onend=null;voiceRecognition.stop();}catch(_){} voiceRecognition=null;}
  setVoiceStatus(false);
}
function toggleVoiceControl(){voiceControlOn?stopVoiceControl():startVoiceControl();}

function statusBadge(s){const map={payment_received:['PENDING APPROVAL','pending'],approved:['APPROVED','approved'],paid:['APPROVED','approved'],rejected:['REJECTED','rejected'],created:['WAITING PAYMENT','created']};const a=map[s]||[String(s).toUpperCase(), 'created'];return '<span class="badge '+a[1]+'">'+a[0]+'</span>';}
function renderDashboardStats(d){const t=d.today||{};return '<div class="stat today-sold"><span>🛒 Today Sold IDs</span><b>'+Number(t.today_sold_ids||0)+'</b><small>आज बिके हुए IDs</small></div><div class="stat today-added"><span>➕ Today IDs Added</span><b>'+Number(t.today_ids_added||0)+'</b><small>आज stock में जोड़े गए</small></div><div class="stat today-rejected"><span>❌ Today Reject</span><b>'+Number(t.today_rejected||0)+'</b><small>आज rejected payments</small></div><div class="stat today-approved"><span>✅ Today Approve</span><b>'+Number(t.today_approved||0)+'</b><small>आज approved payments</small></div><div class="stat"><span>📦 Available IDs</span><b>'+Number(d.stock||0)+'</b><small>Current stock</small></div><div class="stat"><span>📊 Total Sold IDs</span><b>'+Number(d.sold||0)+'</b><small>All-time sold</small></div><div class="stat"><span>⏳ Pending Approval</span><b>'+(d.orders||[]).filter(x=>x.status==='payment_received').length+'</b><small>Waiting for admin</small></div><div class="stat"><span>🧾 Recent Orders</span><b>'+(d.orders||[]).length+'</b><small>Latest 100 orders</small></div>';}
function speakPaymentRequest(){
  if(paymentAlertBusy) return;
  paymentAlertBusy=true;
  try{
    const voices=window.speechSynthesis?.getVoices?.()||[];
    const hi=voices.find(v=>/^hi(-|_)?IN/i.test(v.lang||'')) || voices.find(v=>/hindi/i.test(v.name||'')) || voices.find(v=>/^hi/i.test(v.lang||''));
    let count=0;
    const speakOne=()=>{
      if(count>=3){paymentAlertBusy=false;return;}
      const u=new SpeechSynthesisUtterance('Boss, payment request aaya hai.');
      u.lang='hi-IN';
      u.rate=0.9;
      u.pitch=1.12;
      u.volume=1;
      if(hi) u.voice=hi;
      u.onend=()=>{count++;setTimeout(speakOne,180);};
      u.onerror=()=>{count++;setTimeout(speakOne,180);};
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    };
    speakOne();
  }catch(e){paymentAlertBusy=false;console.warn('Payment voice alert:',e);}
}
function checkForNewPaymentRequests(rows){
  voicePendingOrders=(rows||[]).filter(r=>r.status==='payment_received').sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  const current=new Set((rows||[]).filter(r=>r.status==='payment_received').map(r=>String(r.order_id)));
  if(!paymentAlertReady){
    knownPaymentRequestIds=current;
    paymentAlertReady=true;
    return;
  }
  let isNew=false;
  current.forEach(id=>{if(!knownPaymentRequestIds.has(id)) isNew=true;});
  knownPaymentRequestIds=current;
  if(isNew){
    const newest=(rows||[]).filter(r=>r.status==='payment_received').sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0];
    if(newest) latestPaymentRequestId=String(newest.order_id);
    speakPaymentRequest();
  }
}
function startOrdersAutoRefresh(){
  if(ordersRefreshTimer) return;
  ordersRefreshTimer=setInterval(async ()=>{
    if(ordersRefreshBusy) return;
    ordersRefreshBusy=true;
    try{
      const r=await fetch('/api/admin/dashboard?ts='+Date.now(),{cache:'no-store'});
      if(!r.ok) return;
      const d=await r.json();
      checkForNewPaymentRequests(d.orders||[]);
      const pending=voicePendingOrders;
      if(pending.length) latestPaymentRequestId=String(pending[0].order_id); else latestPaymentRequestId=null;
      const ordersSection=$('orders');
      if(ordersSection && !ordersSection.classList.contains('hidden')) { $('ordersTable').innerHTML=ordersTable(d.orders||[]); }
      $('dash').innerHTML=renderDashboardStats(d);
    }catch(e){ console.warn('Auto refresh:',e); }
    finally{ ordersRefreshBusy=false; }
  },3000);
}
function stopOrdersAutoRefresh(){
  if(ordersRefreshTimer){clearInterval(ordersRefreshTimer);ordersRefreshTimer=null;}
}

async function load(){const r=await fetch('/api/admin/dashboard?ts='+Date.now(),{cache:'no-store'});if(!r.ok){$('panel').classList.add('hidden');$('login').classList.remove('hidden');return;}const d=await r.json();
checkForNewPaymentRequests(d.orders||[]);
$('dash').innerHTML=renderDashboardStats(d);
const s=d.settings||{};window.bonusOfferEnabled=s.bonus_offer_enabled!=='false';$('settings').innerHTML='<div class="gateway-tip">📱 <b>UPI QR:</b> हर order में खरीदी गई ID की संख्या के हिसाब से exact amount वाला UPI QR अपने आप बनेगा. Payment के बाद customer UTR submit करेगा और आप manually approve करेंगे.</div><div class="formgrid">'+[['site_name','Site Name'],['whatsapp_number','WhatsApp Number'],['price_per_id','Price per ID'],['upi_vpa','UPI ID / VPA'],['upi_name','UPI Payee Name']].map(([k,l])=>'<label>'+l+'<input id="s_'+k+'" value="'+esc(s[k]||'')+'"></label>').join('')+'</div><label class="news-label">News / Announcement<textarea id="s_news" rows="4" placeholder="Store news यहाँ लिखें...">'+esc(s.news||'')+'</textarea></label>';
$('ordersTable').innerHTML=ordersTable(d.orders||[]);
$('inventoryTable').innerHTML='<h3>Current Inventory</h3>'+inventoryTable(d.inventory||[]);
$('bonusManage').innerHTML=renderBonusManagement(s);$('discountManage').innerHTML=renderPackageDiscountManagement(s);}
function ordersTable(rows){
  // Payment Approvals में केवल UTR/payment submit किए हुए orders दिखाएँ.
  // WAITING PAYMENT (created) orders user के order-check flow में रहेंगे,
  // लेकिन admin approval list में नहीं दिखेंगे.
  rows=(rows||[]).filter(r=>r.status!=='created');
  if(!rows.length)return '<div class="empty">No payment requests yet.</div>';
  return '<div class="table-wrap"><table><thead><tr><th>Order</th><th>Amount</th><th>UTR / Payment</th><th>Status</th><th>Created</th><th>Action</th></tr></thead><tbody>'+rows.map(r=>'<tr><td><b>'+esc(r.order_id)+'</b><br>'+esc(r.package_qty)+' ID</td><td>₹'+(Number(r.amount_paise||0)/100).toLocaleString('en-IN')+'</td><td><code>'+esc(r.utr||r.payment_id||'—')+'</code></td><td>'+statusBadge(r.status)+'</td><td>'+esc(new Date(r.created_at).toLocaleString('en-IN'))+'</td><td>'+(r.status==='payment_received'?'<button class="approve" onclick="approve(\''+esc(r.order_id)+'\')">✓ APPROVE & RELEASE ID</button><button class="reject" onclick="rejectOrder(\''+esc(r.order_id)+'\')">Reject</button>':r.status==='approved'||r.status==='paid'?'<span class="oktext">ID released</span>':r.status==='rejected'?'<span class="oktext">Rejected</span>':'—')+'</td></tr>').join('')+'</tbody></table></div>';
}
function renderPackageDiscountManagement(s){
  const pqty=[1,2,5,10,15,20];
  const rows=pqty.map(q=>{
    const base=Number(s.price_per_id||0)*q;
    const dis=Number(s['package_discount_'+q]||0);
    const safeDis=Number.isFinite(dis)&&dis>0?Math.min(base,dis):0;
    const final=Math.max(0,base-safeDis);
    return '<div class=\"discount-row\"><div class=\"discount-title\"><b>'+q+' ID Package</b><span>Base Price: ₹'+base.toLocaleString('en-IN')+'</span></div><label>Save Discount (₹)<input class=\"packageDiscount\" data-qty=\"'+q+'\" type=\"number\" min=\"0\" max=\"'+base+'\" step=\"1\" value=\"'+safeDis+'\"></label><div class=\"discount-final\">Customer pays <b>₹'+final.toLocaleString('en-IN')+'</b><br><small>Save ₹'+safeDis.toLocaleString('en-IN')+'</small></div></div>';
  }).join('');
  return '<div class=\"discount-settings-box discount-standalone\"><div class=\"discount-note\"><b>Manual Save Discount</b><br>Example: 5 ID का Base ₹1000 है और आप ₹30 discount रखते हैं, तो customer को ₹970 दिखेगा और <b>Save ₹30</b> लिखा आएगा.</div><div class=\"discount-list\">'+rows+'</div><button class=\"primary discount-save-btn\" onclick=\"savePackageDiscounts()\">💾 SAVE ALL DISCOUNTS</button><div id=\"discountSaveMsg\"></div></div>';
}

function renderBonusManagement(s){
  const enabled=s.bonus_offer_enabled!=='false';
  const qty=Math.max(1,Math.min(100000,parseInt(s.bonus_purchase_qty,10)||10));
  return '<div class="bonus-control"><div><b>🎁 '+qty+' ID Purchase Bonus</b><span>Customer bonus offer ON/OFF</span></div><button id="bonusToggle" class="bonus-toggle '+(enabled?'on':'off')+'" onclick="toggleBonusOffer()">'+(enabled?'🟢 BONUS OFFER ON':'🔴 BONUS OFFER OFF')+'</button></div>'
    +'<div class="bonus-settings-box"><h3>⚙ Bonus Eligibility Setting</h3><p>Admin manually तय करें कि कितनी IDs खरीदने पर 1 extra ID bonus मिलेगा.</p><div class="checkrow"><label>Purchase Quantity<input id="bonusPurchaseQty" type="number" min="1" max="100000" value="'+qty+'"></label><button class="primary" onclick="saveBonusPurchaseQty()">💾 SAVE BONUS SETTING</button></div><div class="bonus-preview">Current: '+qty+' ID खरीदने पर 1 extra ID bonus</div></div>'
    +'<div class="manual-bonus-box"><h3>🛠 Manual Bonus Claim</h3><p>Approved bonus-eligible UTR डालकर Admin manually 1 bonus ID release कर सकता है. Bonus पर अलग Admin approval नहीं होगा.</p><div class="checkrow"><label>UTR / Transaction ID<input id="manualBonusUtr" placeholder="UTR डालें"></label><button class="primary" onclick="manualBonusRelease()">🎁 RELEASE 1 BONUS ID</button></div><div id="manualBonusResult"></div></div>';
}
function inventoryTable(rows){if(!rows.length)return '<div class="empty">Inventory empty.</div>';return '<div class="secure-note">🔐 ID/password values are stored securely on the server and are not exposed in the browser inventory list.</div><div class="table-wrap"><table><thead><tr><th>Record</th><th>Status</th><th>Order</th><th>Added</th><th></th></tr></thead><tbody>'+rows.map(r=>'<tr><td>#'+Number(r.id)+'</td><td>'+statusBadge(r.status)+'</td><td>'+esc(r.sold_order_id||'—')+'</td><td>'+esc(new Date(r.created_at).toLocaleString('en-IN'))+'</td><td>'+ (r.status==='available'?'<button class="reject" onclick="deleteID('+Number(r.id)+')">Delete</button>':'')+'</td></tr>').join('')+'</tbody></table></div>';}

async function approve(id){if(!confirm('Payment verify karke ID release karni hai?'))return;const r=await fetch('/api/admin/orders/'+encodeURIComponent(id)+'/approve',{method:'POST'});const d=await r.json();alert(r.ok?'Payment approved — ID released.':d.error||'Approval failed');if(r.ok)load();}
async function rejectOrder(id){if(!confirm('Is payment ko reject karna hai?'))return;const r=await fetch('/api/admin/orders/'+encodeURIComponent(id)+'/reject',{method:'POST'});const d=await r.json();alert(r.ok?'Payment rejected.':d.error||'Reject failed');if(r.ok)load();}
async function deleteID(id){if(!confirm('Available ID delete karein?'))return;const r=await fetch('/api/admin/inventory/'+id,{method:'DELETE'});if(r.ok)load();}
async function addIDs(){const lines=$('ids').value.split('\n').map(x=>x.trim()).filter(Boolean);const items=lines.map(line=>{const p=line.split('|').map(x=>x.trim());return {login_id:p[0],login_password:p[1]||'',extra_data:p.slice(2).join(' | ')};});const r=await fetch('/api/admin/inventory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items})});const d=await r.json();alert(r.ok?'IDs added successfully.':d.error||'Failed');if(r.ok){$('ids').value='';load();}}
async function saveSettings(){const keys=['site_name','whatsapp_number','price_per_id','upi_vpa','upi_name','news'];const body={};keys.forEach(k=>body[k]=$('s_'+k).value);body.price_per_id=String(Number(body.price_per_id));body.bonus_offer_enabled=window.bonusOfferEnabled?'true':'false';const r=await fetch('/api/admin/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));alert(r.ok?'Settings saved. Website rate is now ₹'+Number(d.pricePerId||0).toLocaleString('en-IN')+' per ID.':'Failed: '+(d.error||'Unable to save'));if(r.ok)load();}
window.bonusOfferEnabled=true;
function toggleBonusOffer(){window.bonusOfferEnabled=!window.bonusOfferEnabled;const b=$('bonusToggle');if(b){b.className='bonus-toggle '+(window.bonusOfferEnabled?'on':'off');b.textContent=window.bonusOfferEnabled?'🟢 BONUS OFFER ON':'🔴 BONUS OFFER OFF';}saveSettings();}
async function savePackageDiscounts(){
  const body={};
  document.querySelectorAll('.packageDiscount').forEach(el=>{
    const qty=Number(el.dataset.qty);
    body['package_discount_'+qty]=String(Math.max(0,Number(el.value)||0));
  });
  const r=await fetch('/api/admin/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d=await r.json().catch(()=>({}));
  const msg=$('discountSaveMsg');
  if(!r.ok){if(msg)msg.textContent=d.error||'Discount save failed';return;}
  if(msg)msg.textContent='✓ Package discounts saved. Customer prices will update immediately.';
  load();
}
async function saveBonusPurchaseQty(){
  const el=$('bonusPurchaseQty');
  const qty=Number(el?.value);
  if(!Number.isInteger(qty)||qty<1||qty>100000){return alert('Bonus purchase quantity 1 से 100000 के बीच रखें.');}
  const body={bonus_purchase_qty:String(qty)};
  const r=await fetch('/api/admin/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok){return alert(d.error||'Bonus setting save failed');}
  alert('ठीक है बॉस, अब '+qty+' ID खरीदने पर 1 bonus ID eligible होगी.');
  load();
}
async function manualBonusRelease(){const utr=String($('manualBonusUtr')?.value||'').trim();if(!utr)return alert('UTR डालें.');if(!confirm('इस UTR पर 1 bonus ID manually release करनी है?'))return;const r=await fetch('/api/admin/manual-bonus-release/'+encodeURIComponent(utr),{method:'POST'});const d=await r.json().catch(()=>({}));const out=$('manualBonusResult');if(r.ok){out.innerHTML='<div class=\"manual-success\">✓ Bonus ID released successfully.<br><b>Login:</b> '+esc(d.bonus?.login_id||'')+'<br><b>Password:</b> '+esc(d.bonus?.login_password||'')+'</div>';$('manualBonusUtr').value='';load();}else{if(out)out.innerHTML='<div class=\"manual-error\">'+esc(d.error||'Manual bonus release failed')+'</div>';}}
$('assets').onsubmit=async e=>{e.preventDefault();const r=await fetch('/api/admin/assets',{method:'POST',body:new FormData($('assets'))});alert(r.ok?'Assets uploaded.':'Upload failed');if(r.ok)load();};
fetch('/api/admin/me').then(r=>{if(r.ok){$('login').classList.add('hidden');$('panel').classList.remove('hidden');load();startOrdersAutoRefresh();}});
