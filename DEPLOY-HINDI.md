# NISHAD BRAND — Render + UPI Setup

## Recommended: use render.yaml
This ZIP contains `render.yaml`. It creates the web service and a PostgreSQL database and connects `DATABASE_URL` automatically.

If you deploy from an existing Render Web Service instead, create a PostgreSQL database in Render and copy its **Internal Database URL** into the Web Service Environment Variables as `DATABASE_URL`.

## Required Environment Variables
- `DATABASE_URL` = Render PostgreSQL Internal Database URL
- `DATABASE_SSL` = `true`
- `NODE_ENV` = `production`
- `ADMIN_USERNAME` = your admin username
- `ADMIN_PASSWORD` = a strong admin password
- `JWT_SECRET` = a long random secret


## UPI webhook
After Render gives the service URL, set the webhook URL to:
`https://YOUR-RENDER-DOMAIN/api/payment/webhook`


### V25 Payment Fix
2. Real payment के लिए `rzp_live_...` LIVE keys इस्तेमाल करें; Test Mode keys से live money collect नहीं होगी.
3. Admin → Store Settings में `UPI ID / VPA` केवल fallback के लिए है.
4. UPI webhook में payment events enable रखें ताकि captured QR payments जल्दी `payment_received` बनें. Server polling भी backup verification करता है.


## Maintenance / Preview Workflow
1. Admin Panel → Store Settings → **Maintenance Mode ON** करें.
2. नई ZIP/commit Render पर deploy करें.
3. Admin में login करके **OPEN PREVIEW MODE** दबाएँ.
4. `/preview` में पूरा storefront test करें. यह केवल logged-in admin के लिए है.
5. Test सही होने के बाद Maintenance Mode OFF करके customer traffic live storefront पर वापस लाएँ.
