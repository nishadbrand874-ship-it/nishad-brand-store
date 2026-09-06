# NISHAD BRAND — ID Store

यह project customer storefront + admin panel + PostgreSQL + Razorpay server-side verification के लिए है।

## सबसे जरूरी बात
Static UPI QR से किसी specific order की payment को भरोसेमंद तरीके से automatic verify नहीं किया जा सकता। इस project में Razorpay Checkout + server-side signature verification + webhook रखा गया है। Razorpay के official docs के अनुसार payment signature server पर verify करना चाहिए और webhooks server को payment events देते हैं।

## Setup
1. PostgreSQL database बनाएं।
2. `.env.example` को `.env` नाम दें और values भरें।
3. `npm install`
4. `npm start`
5. Customer: `/`
6. Admin: `/admin`

## Render
- Build Command: `npm install`
- Start Command: `npm start`
- Environment variables `.env.example` से भरें।
- Production में PostgreSQL database रखें; local SQLite की जरूरत नहीं।

## Razorpay
Dashboard से API keys बनाएं और webhook URL रखें:
`https://YOUR-DOMAIN/api/payment/webhook`

Webhook secret को `RAZORPAY_WEBHOOK_SECRET` में रखें। Live mode में HTTPS URL इस्तेमाल करें। `payment.captured` और/या `order.paid` event enable करें।

## Admin
Initial username/password `.env` से आते हैं। Strong password लगाएं।

Admin से:
- package rates बदलें
- WhatsApp number बदलें
- logo बदलें
- QR image बदलें
- IDs add करें
- orders/inventory देखें

## UTR Check
Verified payment के बाद server Razorpay payment entity से उपलब्ध UTR/RRN को save करता है। Customer UTR या payment ID से verified order की purchased IDs देख सकता है।

## Production notes
- `JWT_SECRET`, API keys और webhook secret कभी frontend में न डालें।
- HTTPS अनिवार्य रखें।
- Webhook duplicate events के लिए fulfillment idempotent है।
- Payment के बिना ID fulfill नहीं होती।


## Fake Payment Protection
- ID केवल Razorpay से server-side verified/captured payment के बाद release होगी.
- Order ID, payment ID, signature, amount, currency और captured status server पर दोबारा verify होते हैं.
- केवल browser में success दिखाने या नकली UTR डालने से ID release नहीं होगी.
- Live payments के लिए Razorpay LIVE `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` और webhook secret configure करें.


## Live Razorpay / Mobile UPI
- Checkout अब Razorpay के device-supported payment methods को दिखाने देता है।
- Compatible mobile पर installed UPI apps / UPI Intent उपलब्ध हो सकता है; desktop पर UPI QR उपलब्ध हो सकता है।
- `Test Mode` को code/CSS से छिपाना सही समाधान नहीं है। यह Razorpay की environment/key स्थिति से आता है।
- Production में Render Environment Variables में **LIVE** Razorpay Key ID और Key Secret लगाएँ और Razorpay Dashboard में Live mode की credentials/webhook configuration करें।
- Fake/client-side payment से inventory release नहीं होगी; server Razorpay payment को दोबारा verify करता है।

## Payment methods
Razorpay Checkout में UPI और Netbanking रखे गए हैं; Card और Wallet हटाए गए हैं.
