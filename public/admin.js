'use strict';
const $=function(x){return document.getElementById(x);};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c];});}
async function login(){
  const r=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('user').value,password:$('pass').value})});
  const d=await r.json();
  if(r.ok){$('login').classList.add('hidden');$('panel').classList.remove('hidden');load();}else $('msg').textContent=d.error||'Login failed';
}
async function logout(){await fetch('/api/admin/logout',{method:'POST'});location.reload();}
async function load(){
  const r=await fetch('/api/admin/dashboard');
  if(!r.ok){$('panel').classList.add('hidden');$('login').classList.remove('hidden');return;}
  const d=await r.json();
  $('dash').innerHTML='<div class="grid"><div><b>Available</b><h2>'+d.stock+'</h2></div><div><b>Sold</b><h2>'+d.sold+'</h2></div></div>';
  const s=d.settings||{};
  const keys=['site_name','whatsapp_number','price_per_id','news'];
  $('settings').innerHTML='<div class="grid">'+keys.filter(function(k){return k!=="news";}).map(function(k){return '<label>'+k+'<input id="s_'+k+'" value="'+esc(s[k]||'')+'"></label>';}).join('')+'</div><label class="news-label">News / Announcement<textarea id="s_news" rows=3 placeholder="Example: आज 10 ID उपलब्ध हैं • नया रेट लागू है">'+esc(s.news||'')+'</textarea></label>';
  $('tables').innerHTML='<h3>Orders</h3>'+table(d.orders,['order_id','package_qty','amount_paise','status','payment_id','utr','customer_name','created_at'])+'<h3>Inventory</h3>'+table(d.inventory,['id','login_id','login_password','status','sold_order_id']);
}
function table(rows,keys){
  return '<table><tr>'+keys.map(function(k){return '<th>'+k+'</th>';}).join('')+'</tr>'+(rows||[]).map(function(row){return '<tr>'+keys.map(function(k){return '<td>'+esc(row[k])+'</td>';}).join('')+'</tr>';}).join('')+'</table>';
}
async function saveSettings(){
  const keys=['site_name','whatsapp_number','price_per_id','news'];
  const body={}; keys.forEach(function(k){body[k]=$('s_'+k).value;});
  const r=await fetch('/api/admin/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  alert(r.ok?'Saved':'Failed'); load();
}
async function addIDs(){
  const lines=$('ids').value.split('\n').map(function(x){return x.trim();}).filter(Boolean);
  const items=lines.map(function(line){const p=line.split('|').map(function(x){return x.trim();});return {login_id:p[0],login_password:p[1]||'',extra_data:p.slice(2).join(' | ')};});
  const r=await fetch('/api/admin/inventory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:items})});
  const d=await r.json(); alert(r.ok?'IDs added':d.error||'Failed'); if(r.ok){$('ids').value='';load();}
}
$('assets').onsubmit=async function(e){e.preventDefault();const r=await fetch('/api/admin/assets',{method:'POST',body:new FormData($('assets'))});alert(r.ok?'Uploaded':'Upload failed');load();};
fetch('/api/admin/me').then(function(r){if(r.ok){$('login').classList.add('hidden');$('panel').classList.remove('hidden');load();}});
