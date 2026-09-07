'use strict';
let ordersRefreshTimer=null;
let ordersRefreshBusy=false;
const $=id=>document.getElementById(id);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
function toggleMenu(){$('menu').classList.toggle('hidden')}
function showSection(id){document.querySelectorAll('.section').forEach(x=>x.classList.add('hidden'));$(id).classList.remove('hidden');$('menu').classList.add('hidden');window.scrollTo({top:0,behavior:'smooth'});}
async function login(){const r=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('user').value,password:$('pass').value})});const d=await r.json();if(r.ok){$('login').classList.add('hidden');$('panel').classList.remove('hidden');load();startOrdersAutoRefresh();}else $('msg').textContent=d.error||'Login failed';}
async function logout(){await fetch('/api/admin/logout',{method:'POST'});location.reload();}
function statusBadge(s){const map={payment_received:['PENDING APPROVAL','pending'],approved:['APPROVED','approved'],paid:['APPROVED','approved'],rejected:['REJECTED','rejected'],created:['WAITING PAYMENT','created']};const a=map[s]||[String(s).toUpperCase(), 'created'];return '<span class="badge '+a[1]+'">'+a[0]+'</span>';}
function startOrdersAutoRefresh(){
  if(ordersRefreshTimer) return;
  ordersRefreshTimer=setInterval(async ()=>{
    if(ordersRefreshBusy) return;
    const ordersSection=$('orders');
    if(!ordersSection || ordersSection.classList.contains('hidden')) return;
    ordersRefreshBusy=true;
    try{
      const r=await fetch('/api/admin/dashboard?ts='+Date.now(),{cache:'no-store'});
      if(!r.ok) return;
      const d=await r.json();
      $('ordersTable').innerHTML=ordersTable(d.orders||[]);
      $('dash').innerHTML='<div class="stat"><span>Available IDs</span><b>'+d.stock+'</b></div><div class="stat"><span>Sold IDs</span><b>'+d.sold+'</b></div><div class="stat"><span>Pending Approval</span><b>'+(d.orders||[]).filter(x=>x.status==='payment_received').length+'</b></div><div class="stat"><span>Total Orders</span><b>'+(d.orders||[]).length+'</b></div>';
    }catch(e){ console.warn('Auto refresh:',e); }
    finally{ ordersRefreshBusy=false; }
  },3000);
}
function stopOrdersAutoRefresh(){
  if(ordersRefreshTimer){clearInterval(ordersRefreshTimer);ordersRefreshTimer=null;}
}

async function load(){const r=await fetch('/api/admin/dashboard?ts='+Date.now(),{cache:'no-store'});if(!r.ok){$('panel').classList.add('hidden');$('login').classList.remove('hidden');return;}const d=await r.json();
$('dash').innerHTML='<div class="stat"><span>Available IDs</span><b>'+d.stock+'</b></div><div class="stat"><span>Sold IDs</span><b>'+d.sold+'</b></div><div class="stat"><span>Pending Approval</span><b>'+(d.orders||[]).filter(x=>x.status==='payment_received').length+'</b></div><div class="stat"><span>Total Orders</span><b>'+(d.orders||[]).length+'</b></div>';
const s=d.settings||{};$('settings').innerHTML='<div class="gateway-tip">📱 <b>UPI QR:</b> हर order में खरीदी गई ID की संख्या के हिसाब से exact amount वाला UPI QR अपने आप बनेगा. Payment के बाद customer UTR submit करेगा और आप manually approve करेंगे.</div><div class="formgrid">'+[['site_name','Site Name'],['whatsapp_number','WhatsApp Number'],['price_per_id','Price per ID'],['upi_name','UPI Payee Name']].map(([k,l])=>'<label>'+l+'<input id="s_'+k+'" value="'+esc(s[k]||'')+'"></label>').join('')+'</div><label class="news-label">News / Announcement<textarea id="s_news" rows="4" placeholder="Store news यहाँ लिखें...">'+esc(s.news||'')+'</textarea></label>';
$('ordersTable').innerHTML=ordersTable(d.orders||[]);$('inventoryTable').innerHTML='<h3>Current Inventory</h3>'+inventoryTable(d.inventory||[]);}
function ordersTable(rows){if(!rows.length)return '<div class="empty">No orders yet.</div>';return '<div class="table-wrap"><table><thead><tr><th>Order</th><th>Amount</th><th>UTR / Payment</th><th>Status</th><th>Created</th><th>Action</th></tr></thead><tbody>'+rows.map(r=>'<tr><td><b>'+esc(r.order_id)+'</b><br>'+esc(r.package_qty)+' ID</td><td>₹'+(Number(r.amount_paise||0)/100).toLocaleString('en-IN')+'</td><td><code>'+esc(r.utr||r.payment_id||'—')+'</code></td><td>'+statusBadge(r.status)+'</td><td>'+esc(new Date(r.created_at).toLocaleString('en-IN'))+'</td><td>'+(r.status==='payment_received'?'<button class="approve" onclick="approve(\''+esc(r.order_id)+'\')">✓ APPROVE & RELEASE ID</button><button class="reject" onclick="rejectOrder(\''+esc(r.order_id)+'\')">Reject</button>':r.status==='approved'||r.status==='paid'?'<span class="oktext">ID released</span>':'—')+'</td></tr>').join('')+'</tbody></table></div>';}
function inventoryTable(rows){if(!rows.length)return '<div class="empty">Inventory empty.</div>';return '<div class="table-wrap"><table><thead><tr><th>ID</th><th>Password</th><th>Status</th><th>Order</th><th></th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.login_id)+'</td><td>'+esc(r.login_password||'')+'</td><td>'+statusBadge(r.status)+'</td><td>'+esc(r.sold_order_id||'—')+'</td><td>'+ (r.status==='available'?'<button class="reject" onclick="deleteID('+Number(r.id)+')">Delete</button>':'')+'</td></tr>').join('')+'</tbody></table></div>';}
async function approve(id){if(!confirm('Payment verify karke ID release karni hai?'))return;const r=await fetch('/api/admin/orders/'+encodeURIComponent(id)+'/approve',{method:'POST'});const d=await r.json();alert(r.ok?'Payment approved — ID released.':d.error||'Approval failed');if(r.ok)load();}
async function rejectOrder(id){if(!confirm('Is payment ko reject karna hai?'))return;const r=await fetch('/api/admin/orders/'+encodeURIComponent(id)+'/reject',{method:'POST'});const d=await r.json();alert(r.ok?'Payment rejected.':d.error||'Reject failed');if(r.ok)load();}
async function deleteID(id){if(!confirm('Available ID delete karein?'))return;const r=await fetch('/api/admin/inventory/'+id,{method:'DELETE'});if(r.ok)load();}
async function addIDs(){const lines=$('ids').value.split('\n').map(x=>x.trim()).filter(Boolean);const items=lines.map(line=>{const p=line.split('|').map(x=>x.trim());return {login_id:p[0],login_password:p[1]||'',extra_data:p.slice(2).join(' | ')};});const r=await fetch('/api/admin/inventory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items})});const d=await r.json();alert(r.ok?'IDs added successfully.':d.error||'Failed');if(r.ok){$('ids').value='';load();}}
async function saveSettings(){const keys=['site_name','whatsapp_number','price_per_id','upi_name','news'];const body={};keys.forEach(k=>body[k]=$('s_'+k).value);const r=await fetch('/api/admin/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});alert(r.ok?'Settings saved.':'Failed');if(r.ok)load();}
$('assets').onsubmit=async e=>{e.preventDefault();const r=await fetch('/api/admin/assets',{method:'POST',body:new FormData($('assets'))});alert(r.ok?'Assets uploaded.':'Upload failed');if(r.ok)load();};
fetch('/api/admin/me').then(r=>{if(r.ok){$('login').classList.add('hidden');$('panel').classList.remove('hidden');load();startOrdersAutoRefresh();}});
