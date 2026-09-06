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
