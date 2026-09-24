'use strict';
let ordersRefreshTimer=null;
let ordersRefreshBusy=false;
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
function toggleMenu(){
  const m=$('menu');
  if(window.innerWidth<=900){m.classList.toggle('mobile-open');}
}
function showSection(id){
  const sections=[...document.querySelectorAll('.admin-content .section')];
  let found=false;
  sections.forEach(section=>{
    const active=section.id===id;
    section.classList.toggle('hidden',!active);
    section.setAttribute('aria-hidden',String(!active));
    if(active) found=true;
  });
  document.querySelectorAll('#menu .sidebar-nav button').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.section===id);
    btn.setAttribute('aria-current',btn.dataset.section===id?'page':'false');
  });
  if(window.innerWidth<=900){
    const menu=$('menu');
    if(menu) menu.classList.remove('mobile-open');
  }
  if(found) window.scrollTo({top:0,behavior:'smooth'});
  if(id==='maintenanceSec') updateMaintenanceStatus();
  return found;
}

async function login(){const r=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('user').value,password:$('pass').value})});const d=await r.json();if(r.ok){document.body.classList.remove('auth-locked');$('login').classList.add('hidden');$('panel').classList.remove('hidden');load();startOrdersAutoRefresh();}else $('msg').textContent=d.error||'Login failed';}
async function logout(){
  // Logout in one click: stop client activity immediately, clear the server cookie,
  // then replace the page so the login screen is shown without requiring a second click.
  try{
    if(ordersRefreshTimer){clearInterval(ordersRefreshTimer);ordersRefreshTimer=null;}
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

function startOrdersAutoRefresh(){
  if(ordersRefreshTimer) return;
  ordersRefreshTimer=setInterval(async ()=>{
    if(ordersRefreshBusy) return;
    ordersRefreshBusy=true;
    try{
      const r=await fetch('/api/admin/dashboard?ts='+Date.now(),{cache:'no-store',credentials:'same-origin'});
      if(!r.ok){ stopOrdersAutoRefresh(); return; }
      const d=await r.json();
      const ordersSection=$('orders');
      if(ordersSection && !ordersSection.classList.contains('hidden')) $('ordersTable').innerHTML=ordersTable(d.orders||[]);
      if($('dash')) $('dash').innerHTML=renderDashboardStats(d);
if($('dashboardHistory')) $('dashboardHistory').innerHTML=dashboardHistory(d.orders||[]);
      const s=d.settings||{};
      if($('m_maintenance_mode')){
        $('m_maintenance_mode').checked=s.maintenance_mode==='true';
        $('m_maintenance_message').value=s.maintenance_message||'Website maintenance में है। कृपया थोड़ी देर बाद दोबारा कोशिश करें।';
        $('m_whatsapp_channel').value=s.whatsapp_channel||'';
        updateMaintenanceStatus();
      }
    }catch(e){ console.warn('Auto refresh:',e); }
    finally{ ordersRefreshBusy=false; }
  },3000);
}
function stopOrdersAutoRefresh(){
  if(ordersRefreshTimer){clearInterval(ordersRefreshTimer);ordersRefreshTimer=null;}
}

async function load(){
  const r=await fetch('/api/admin/dashboard?ts='+Date.now(),{cache:'no-store',credentials:'same-origin'});
  if(!r.ok){ document.body.classList.add('auth-locked'); $('panel').classList.add('hidden'); $('login').classList.remove('hidden'); return; }
  document.body.classList.remove('auth-locked');
  const d=await r.json();
  $('dash').innerHTML=renderDashboardStats(d);
  const s=d.settings||{};
  window.bonusOfferEnabled=s.bonus_offer_enabled!=='false';
  $('settings').innerHTML='<div class="gateway-tip"><b>📱 UPI QR</b><br>हर order में खरीदी गई ID की संख्या के हिसाब से exact amount वाला UPI QR अपने आप बनेगा. Payment के बाद customer UTR submit करेगा और आप manually approve करेंगे.</div><div class="formgrid">'+[['site_name','Site Name'],['whatsapp_number','WhatsApp Number'],['price_per_id','Price per ID'],['upi_vpa','UPI ID / VPA'],['upi_name','UPI Payee Name']].map(([k,l])=>'<label>'+l+'<input id="s_'+k+'" value="'+esc(s[k]||'')+'"></label>').join('')+'</div><label class="news-label">News / Announcement<textarea id="s_news" rows="4" placeholder="Store news यहाँ लिखें...">'+esc(s.news||'')+'</textarea></label><div class="settings-note">🔐 <b>Maintenance</b> अब केवल Left Sidebar के <b>Maintenance</b> option से manage होगा.</div>';
  $('ordersTable').innerHTML=ordersTable(d.orders||[]);
  $('inventoryTable').innerHTML='<h3>Current Inventory</h3>'+inventoryTable(d.inventory||[]);
  $('bonusManage').innerHTML=renderBonusManagement(s);
  $('discountManage').innerHTML=renderPackageDiscountManagement(s);
  if($('m_maintenance_mode')){
    $('m_maintenance_mode').checked=s.maintenance_mode==='true';
    $('m_maintenance_message').value=s.maintenance_message||'Website maintenance में है। कृपया थोड़ी देर बाद दोबारा कोशिश करें।';
    $('m_whatsapp_channel').value=s.whatsapp_channel||'';
    updateMaintenanceStatus();
  }
}
function renderDashboardStats(d){const t=d.today||{};return '<div class="stat today-sold"><span>🛒 Today Sold IDs</span><b>'+Number(t.today_sold_ids||0)+'</b><small>आज बिके हुए IDs</small></div><div class="stat today-added"><span>➕ Today IDs Added</span><b>'+Number(t.today_ids_added||0)+'</b><small>आज stock में जोड़े गए</small></div><div class="stat today-rejected"><span>❌ Today Reject</span><b>'+Number(t.today_rejected||0)+'</b><small>आज rejected payments</small></div><div class="stat today-approved"><span>✅ Today Approve</span><b>'+Number(t.today_approved||0)+'</b><small>आज approved payments</small></div><div class="stat"><span>📦 Available IDs</span><b>'+Number(d.stock||0)+'</b><small>Current stock</small></div><div class="stat"><span>📊 Total Sold IDs</span><b>'+Number(d.sold||0)+'</b><small>All-time sold</small></div><div class="stat"><span>⏳ Pending Approval</span><b>'+(d.orders||[]).filter(x=>x.status==='payment_received').length+'</b><small>Waiting for admin</small></div><div class="stat"><span>🧾 Recent Orders</span><b>'+(d.orders||[]).length+'</b><small>Latest 100 orders</small></div>'; }
function dashboardHistory(rows){
  rows=(rows||[]).filter(r=>r.status!=='created').slice(0,8);
  if(!rows.length) return '<div class="empty history-empty">No payment history yet.</div>';
  return '<div class="history-table-wrap"><table class="history-table"><thead><tr><th>Order</th><th>Amount</th><th>UTR</th><th>Status</th><th>Date</th></tr></thead><tbody>'+rows.map(r=>'<tr><td><b>'+esc(r.order_id)+'</b><br><small>'+esc(r.package_qty)+' ID</small></td><td>₹'+(Number(r.amount_paise||0)/100).toLocaleString('en-IN')+'</td><td><code>'+esc(r.utr||r.payment_id||'—')+'</code></td><td>'+statusBadge(r.status)+'</td><td>'+esc(new Date(r.created_at).toLocaleString('en-IN'))+'</td></tr>').join('')+'</tbody></table></div>';
}
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
function openPreviewMode(){
  const w=window.open('/preview','_blank','noopener,noreferrer');
  if(!w) alert('Preview open नहीं हुआ। Browser में pop-up allow करें.');
}
function updateMaintenanceStatus(){
  const cb=$('m_maintenance_mode'), st=$('maintenanceStatus');
  if(!cb||!st)return;
  const on=cb.checked;
  st.className='maintenance-status '+(on?'on':'off');
  st.textContent=on?'● MAINTENANCE ON':'● MAINTENANCE OFF';
}
async function saveMaintenanceSettings(){
  const body={
    maintenance_mode:$('m_maintenance_mode')?.checked?'true':'false',
    maintenance_message:$('m_maintenance_message')?.value||'Website maintenance में है। कृपया थोड़ी देर बाद दोबारा कोशिश करें।',
    whatsapp_channel:$('m_whatsapp_channel')?.value||''
  };
  const r=await fetch('/api/admin/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok){alert('Maintenance save failed: '+(d.error||'Unable to save'));return;}
  alert(body.maintenance_mode==='true'?'Maintenance Mode ON कर दिया गया.':'Maintenance Mode OFF कर दिया गया.');
  load();
}
async function saveSettings(){
  const keys=['site_name','whatsapp_number','price_per_id','upi_vpa','upi_name','news'];
  const body={};
  keys.forEach(k=>body[k]=$('s_'+k).value);
  body.price_per_id=String(Number(body.price_per_id));
  body.bonus_offer_enabled=window.bonusOfferEnabled?'true':'false';
  const r=await fetch('/api/admin/settings',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(body)});
  const d=await r.json().catch(()=>({}));
  alert(r.ok?'Store settings saved. Website rate is now ₹'+Number(d.pricePerId||body.price_per_id||0).toLocaleString('en-IN')+' per ID.':'Failed: '+(d.error||'Unable to save'));
  if(r.ok) load();
}
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
if(document.body.classList.contains('auth-locked')){} else { showSection('overview'); }
$('assets').onsubmit=async e=>{e.preventDefault();const r=await fetch('/api/admin/assets',{method:'POST',body:new FormData($('assets'))});alert(r.ok?'Assets uploaded.':'Upload failed');if(r.ok)load();};
fetch('/api/admin/me').then(r=>{if(r.ok){document.body.classList.remove('auth-locked');$('login').classList.add('hidden');$('panel').classList.remove('hidden');load();startOrdersAutoRefresh();}});
