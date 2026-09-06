'use strict';
let config = null;
let selected = null;
const $ = id => document.getElementById(id);
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c];
  });
}
function money(n){ return Number(n || 0).toLocaleString('en-IN'); }
async function init(){
  try {
    const r = await fetch('/api/config');
    config = await r.json();
    if(!r.ok) throw new Error(config.error || 'Configuration failed');
    $('siteName').textContent = config.siteName || 'NISHAD BRAND';
    $('logo').src = config.logo || '/logo.png';
    const qrEl = $('qr'); if (qrEl) qrEl.src = config.qr || '/payment-qr.png';
    $('wa').href = 'https://wa.me/' + String(config.whatsapp || '').replace(/\D/g,'');
    const newsBar=$('newsBar'), newsText=$('newsText');
    if(config.news && String(config.news).trim()){ newsText.textContent=config.news; newsBar.classList.remove('hidden'); } else { newsBar.classList.add('hidden'); }
    const box = $('packages');
    const packages = config.packages || [];
    box.classList.remove('hidden');
    box.innerHTML = packages.map(function(p){
      const disabled = !p.available || !p.price;
      const label = !p.available ? 'Out of Stock' : (!p.price ? 'Price Not Set' : 'Buy Now');
      return '<div class="card"><div class="qty">' + p.qty + ' ID</div><div class="price">₹' + money(p.price) + '</div><button class="buy" ' + (disabled ? 'disabled' : '') + ' onclick="openPay(' + p.qty + ',' + Number(p.price || 0) + ')">' + label + '</button></div>';
    }).join('') + '<div class="card custom-card"><div class="qty">Custom Quantity</div><div class="custom-help">₹' + money(config.pricePerId) + ' per ID</div><input id="customQty" class="customQty" type="number" min="1" max="' + Number(config.stock || 1) + '" value="1" oninput="updateCustomTotal()"><div id="customTotal" class="price">₹' + money(config.pricePerId) + '</div><button class="buy" ' + (!config.stock || !config.pricePerId ? 'disabled' : '') + ' onclick="buyCustom()">Buy Custom Quantity</button></div>';
    updateCustomTotal();
  } catch(e) {
    $('packages').innerHTML = '<div class="error">Store load failed: ' + esc(e.message) + '</div>';
  }
}
function updateCustomTotal(){
  const el=$('customQty'); const total=$('customTotal');
  if(!el || !total || !config) return;
  let qty=Math.floor(Number(el.value)||1); qty=Math.max(1,Math.min(Number(config.stock||1),qty)); el.value=qty;
  total.textContent='₹'+money(Number(config.pricePerId||0)*qty);
}
function buyCustom(){
  const qty=Math.floor(Number($('customQty')?.value)||0);
  if(!qty || qty<1 || qty>Number(config.stock||0)){ $('payStatus').textContent='Invalid quantity'; return; }
  openPay(qty,Number(config.pricePerId||0)*qty);
}
function openPay(qty, price){
  selected = {qty:qty, price:price};
  $('payText').textContent = qty + ' ID package — ₹' + money(price);
  $('payStatus').innerHTML = '';
  $('modal').classList.remove('hidden');
}
function closePay(){ $('modal').classList.add('hidden'); }
$('payBtn').onclick = async function(){
  if(!selected) return;
  $('payBtn').disabled = true;
  $('payStatus').textContent = 'Creating secure payment…';
  try {
    const r = await fetch('/api/orders', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({qty:selected.qty,name:$('custName').value,phone:$('custPhone').value})});
    const d = await r.json();
    if(!r.ok){ $('payStatus').innerHTML = '<div class="error">' + esc(d.error) + '</div>'; $('payBtn').disabled=false; return; }
    if(typeof Razorpay === 'undefined') throw new Error('Razorpay checkout script did not load');
    const options = {
      key:d.keyId, amount:d.amount, currency:d.currency, name:config.siteName,
      description:selected.qty + ' ID Package', order_id:d.orderId,
      prefill:{name:$('custName').value,contact:$('custPhone').value},
      // Let Razorpay show the payment methods supported by the user's device.
      // On compatible mobile devices this can surface installed UPI apps / UPI Intent.
      // Desktop can show the available UPI QR flow.
      // UPI only. Razorpay lands the customer directly in the UPI flow.
      // On desktop/web, Razorpay can show its dynamic UPI QR.
      // On supported mobile devices, Razorpay uses the appropriate UPI app/intent flow.
      method:'upi',
      config:{
        display:{
          blocks:{
            upi_only:{
              name:'Pay via UPI',
              instruments:[{method:'upi'}]
            }
          },
          sequence:['block.upi_only'],
          preferences:{show_default_blocks:false}
        }
      },
      theme:{color:'#2563eb'},
      handler:async function(resp){
        $('payStatus').textContent='Verifying payment…';
        const vr=await fetch('/api/payment/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(resp)});
        const vd=await vr.json();
        if(vr.ok) showIDs(vd.items,vd.order); else $('payStatus').innerHTML='<div class="error">'+esc(vd.error)+'</div>';
        $('payBtn').disabled=false;
      },
      modal:{ondismiss:function(){ $('payBtn').disabled=false; $('payStatus').textContent='Payment window closed.'; }}
    };
    new Razorpay(options).open();
  } catch(e) {
    $('payStatus').innerHTML='<div class="error">'+esc(e.message)+'</div>';
    $('payBtn').disabled=false;
  }
};
function showIDs(items, order){
  const rows=(items||[]).map(function(x,i){
    return '<div class="idrow"><b>ID '+(i+1)+':</b> <code>'+esc(x.login_id)+'</code>' + (x.login_password ? '<br><b>Password:</b> <code>'+esc(x.login_password)+'</code>' : '') + (x.extra_data ? '<br>'+esc(x.extra_data) : '') + '</div>';
  }).join('');
  $('payStatus').innerHTML='<div class="success"><b>Payment successful.</b><br>UTR/Payment ID: <code>'+esc((order && (order.utr || order.payment_id)) || '')+'</code>'+rows+'</div>';
}
async function checkUTR(){
  const u=$('utr').value.trim(); if(!u)return;
  $('result').textContent='Checking…';
  try{
    const r=await fetch('/api/order-check/'+encodeURIComponent(u));
    const d=await r.json();
    if(!d.found){$('result').innerHTML='<div class="error">Not Found — इस UTR/Payment ID से कोई verified purchase नहीं मिला।</div>';return;}
    showCheck(d.items,d.order);
  }catch(e){$('result').innerHTML='<div class="error">'+esc(e.message)+'</div>';}
}
function showCheck(items,order){
  const rows=(items||[]).map(function(x,i){
    return '<div class="idrow"><b>ID '+(i+1)+':</b> <code>'+esc(x.login_id)+'</code>' + (x.login_password ? '<br><b>Password:</b> <code>'+esc(x.login_password)+'</code>' : '') + (x.extra_data ? '<br>'+esc(x.extra_data) : '') + '</div>';
  }).join('');
  $('result').innerHTML='<div class="success"><b>Verified Purchase</b><br>Order: <code>'+esc(order.order_id)+'</code>'+rows+'</div>';
}
init();
