# NISHAD BRAND — ID Store

यह project customer storefront + admin panel + PostgreSQL + UPI server-side verification के लिए है।

## सबसे जरूरी बात
Static UPI QR से किसी specific order की payment को भरोसेमंद तरीके से automatic verify नहीं किया जा सकता। इस project में UPI Checkout + server-side signature verification + webhook रखा गया है। UPI के official docs के अनुसार payment signature server पर verify करना चाहिए और webhooks server को payment events देते हैं।

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

## UPI
Dashboard से API keys बनाएं और webhook URL रखें:
`https://YOUR-DOMAIN/api/payment/webhook`


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
Verified payment के बाद server UPI payment entity से उपलब्ध UTR/RRN को save करता है। Customer UTR या payment ID से verified order की purchased IDs देख सकता है।

## Production notes
- `JWT_SECRET`, API keys और webhook secret कभी frontend में न डालें।
- HTTPS अनिवार्य रखें।
- Webhook duplicate events के लिए fulfillment idempotent है।
- Payment के बिना ID fulfill नहीं होती।


## Fake Payment Protection
- ID केवल UPI से server-side verified/captured payment के बाद release होगी.
- Order ID, payment ID, signature, amount, currency और captured status server पर दोबारा verify होते हैं.
- केवल browser में success दिखाने या नकली UTR डालने से ID release नहीं होगी.


## Live UPI / Mobile UPI
- Checkout अब UPI के device-supported payment methods को दिखाने देता है।
- Compatible mobile पर installed UPI apps / UPI Intent उपलब्ध हो सकता है; desktop पर UPI QR उपलब्ध हो सकता है।
- `Test Mode` को code/CSS से छिपाना सही समाधान नहीं है। यह UPI की environment/key स्थिति से आता है।
- Production में Render Environment Variables में **LIVE** UPI Key ID और Key Secret लगाएँ और UPI Dashboard में Live mode की credentials/webhook configuration करें।
- Fake/client-side payment से inventory release नहीं होगी; server UPI payment को दोबारा verify करता है।

## Payment methods
UPI Checkout में UPI और Netbanking रखे गए हैं; Card और Wallet हटाए गए हैं.

## UPI App / Auto Verification
- Checkout में केवल UPI enabled है; Netbanking, Card और Wallet disabled हैं.
- Mobile पर compatible होने पर UPI UPI Intent के जरिए supported installed UPI apps का विकल्प दिखा सकता है.
- Website किसी specific app को जबरदस्ती launch नहीं करती; available app/device handling UPI और OS करते हैं.
- Payment के बाद server UPI से payment/order/amount/status verify करता है; verified captured payment के बाद ही ID release होती है.


## UPI-only QR / Automatic Verification
- Checkout को केवल UPI block पर land कराया गया है; Card, Wallet और Netbanking नहीं दिखेंगे.
- Desktop/web पर UPI का dynamic UPI QR उपलब्ध होने पर वही payment QR दिखाया जाएगा.
- Supported mobile devices पर UPI UPI Intent के जरिए installed/supported UPI app खोल सकता है.
- Payment को server UPI से order ID, payment ID, amount, currency और captured status के आधार पर verify करता है.
- Verified captured payment के बिना inventory/ID release नहीं होगी.

## UPI App Redirect + Approval Flow
- User `Buy Now` के बाद केवल UPI payment flow में जाता है.
- Supported mobile device पर UPI UPI Intent के जरिए उपलब्ध installed UPI app पर redirect कर सकता है.
- User payment approve/complete करता है.
- Browser में success दिखना अकेले पर्याप्त नहीं है.
- Server UPI payment/order/amount/currency/captured status verify करने के बाद ही ID release करता है.
- Failed, fake, cancelled या unverified payment पर ID release नहीं होगी.

## V14 Dynamic QR Screen
- Buy Now पर तुरंत compact UPI QR screen खुलती है.
- QR UPI के one-time fixed-amount UPI QR से server पर generate होता है.
- Customer किसी भी supported UPI app से QR scan करके payment कर सकता है.
- Browser हर कुछ seconds में server से payment status check करता है.
- Server केवल UPI के captured UPI payment और exact amount को verify करके inventory ID release करता है.
- Fake/screenshot/manual UTR/failed payment पर ID release नहीं होती.
- UPI account में UPI QR Codes feature enable होना आवश्यक है.


## V15 Fix
- Buy Now buttons are rendered again; the previous V14 had a missing payment button element which stopped `app.js` before package rendering.
- UPI Checkout script is included.
- Buy Now opens the secure UPI-only UPI flow automatically.
- Server-side verification remains mandatory before ID release.

## V16 QR-ONLY
BUY NOW के बाद payment UI में केवल UPI QR presentation रखा गया है।
Card/Netbanking/Wallet options को frontend से छिपाया गया है।
Payment verification server-side रहेगी; verified payment के बाद ही ID release होगी।

## V17 QR IMAGE
User-provided UPI QR image has been placed at `public/payment-qr.png` for the QR-only payment screen.

IMPORTANT: This is a static QR image. Automatic payment verification and ID release require a server-side payment reconciliation/order-verification mechanism; a static QR alone cannot prove which user paid.

## V25 Payment Fix
- UPI API keys available होने पर हर order के लिए exact amount का single-use Dynamic UPI QR (local generated) बनता है.
- UPI QR payment captured होने पर webhook/polling order को `payment_received` करता है; Admin approval के बाद ही inventory release होती है.
- Live collection के लिए UPI LIVE keys और सही webhook secret लगाएँ. Test keys से real-money collection नहीं होगी.
- UPI_VPA अब primary requirement नहीं है; यह fallback के रूप में रखा गया है.


## V26 payment fix
- UPI Dynamic QR request uses the documented `upi_qr` type.
- If UPI QR Codes API is not enabled for the account, checkout automatically falls back to the Admin-configured UPI VPA with the exact amount embedded in the UPI link/QR.
- Therefore the raw `The requested URL was not found on the server.` message is no longer shown to the customer.


### V29 QR note
आपके दिए गए QR से merchant UPI VPA लेकर हर order के लिए नया amount-specific UPI QR बनाया जाता है। 1 ID = ₹1, 5 ID = ₹5, 10 ID = ₹10. UTR field और manual admin approval बरकरार हैं।


### UTR Rejection
Admin kisi payment ko Reject kare to us UTR ko Order Check me search karne par साफ़ “PAYMENT REJECTED” दिखेगा और ID release नहीं होगी.
