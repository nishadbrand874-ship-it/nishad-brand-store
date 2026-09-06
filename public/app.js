let config=null, selected=null;
const $=id=>document.getElementById(id);
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
async function init(){
 const r=await fetch('/api/config'); config=await r.json();
 $('siteName').textContent=config.siteName; $('logo').src=config.logo; $('qr').src=config.qr;
 $('wa').href='https://wa.me/'+String(config.whatsapp||'').replace(/\D/g,'');
 const box=$('packages');
 if(!config.stock){$('stockEmpty').classList.remove('hidden');box.classList.add('hidden');return;}
 box.innerHTML=config.packages.map(p=>`<div class="card"><div class="qty">${p.qty} ID</div><div class="price">₹${p.price.toLocaleString('en-IN')}</div><button class="buy" onclick="openPay(${p.qty},${p.price})">Buy Now</button></div>`).join('');
}
function openPay(qty,price){selected={qty,price};$('payText').textContent=`${qty} ID package — ₹${price.toLocaleString('en-IN')}`;$('payStatus').innerHTML='';$('modal').classList.remove('hidden');}
function closePay(){$('modal').classList.add('hidden')}
$('payBtn').onclick=async()=>{
 if(!selected)return; $('payBtn').disabled=true;$('payStatus').textContent='Creating secure payment…';
 const r=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({qty:selected.qty,name:$('custName').value,phone:$('custPhone').value})}); const d=await r.json();
 if(!r.ok){$('payStatus').innerHTML=`<div class="error">${esc(d.error)}</div>`;$('payBtn').disabled=false;return;}
 const options={key:d.keyId,amount:d.amount,currency:d.currency,name:config.siteName,description:`${selected.qty} ID Package`,order_id:d.orderId,prefill:{name:$('custName').value,contact:$('custPhone').value},handler:async function(resp){
   $('payStatus').textContent='Verifying payment…';
   const vr=await fetch('/api/payment/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(resp)});const vd=await vr.json();
   if(vr.ok){showIDs(vd.items,vd.order);}else $('payStatus').innerHTML=`<div class="error">${esc(vd.error)}</div>`;
   $('payBtn').disabled=false;
 },modal:{ondismiss:function(){$('payBtn').disabled=false;$('payStatus').textContent='Payment window closed.';}}};
 const rp=new Razorpay(options);rp.open();
};
function showIDs(items,order){$('payStatus').innerHTML=`<div class="success"><b>Payment successful.</b><br>UTR/Payment ID: <code>${esc(order.utr||order.payment_id||'')}</code>${items.map((x,i)=>`<div class="idrow"><b>ID ${i+1}:</b> <code>${esc(x.login_id)}</code>${x.login_password?`<br><b>Password:</b> <code>${esc(x.login_password)}</code>`:''}${x.extra_data?`<br>${esc(x.extra_data)}`:''}</div>`).join('')}</div>`;}
async function checkUTR(){const u=$('utr').value.trim();if(!u)return;$('result').textContent='Checking…';const r=await fetch('/api/order-check/'+encodeURIComponent(u));const d=await r.json();if(!d.found){$('result').innerHTML='<div class="error">Not Found — इस UTR/Payment ID से कोई verified purchase नहीं मिला।</div>';return;}showCheck(d.items,d.order);}
function showCheck(items,order){$('result').innerHTML=`<div class="success"><b>Verified Purchase</b><br>Order: <code>${esc(order.order_id)}</code>${items.map((x,i)=>`<div class="idrow"><b>ID ${i+1}:</b> <code>${esc(x.login_id)}</code>${x.login_password?`<br><b>Password:</b> <code>${esc(x.login_password)}</code>`:''}${x.extra_data?`<br>${esc(x.extra_data)}`:''}</div>`).join('')}</div>`;}
init();
