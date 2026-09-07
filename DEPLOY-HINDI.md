# NISHAD BRAND — Render + Razorpay Setup

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
- `RAZORPAY_KEY_ID` = Razorpay Live Key ID
- `RAZORPAY_KEY_SECRET` = Razorpay Live Key Secret
- `RAZORPAY_WEBHOOK_SECRET` = a secret you create

Never put `RAZORPAY_KEY_SECRET` in frontend code or GitHub.

## Razorpay webhook
After Render gives the service URL, set the webhook URL to:
`https://YOUR-RENDER-DOMAIN/api/payment/webhook`

Use the same value for the Razorpay webhook secret and `RAZORPAY_WEBHOOK_SECRET`. Enable `payment.captured` and `order.paid`.

### V25 Payment Fix
1. Render Environment में `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` सही values रखें.
2. Real payment के लिए `rzp_live_...` LIVE keys इस्तेमाल करें; Test Mode keys से live money collect नहीं होगी.
3. Admin → Store Settings में `UPI ID / VPA` केवल fallback के लिए है.
4. Razorpay webhook में payment events enable रखें ताकि captured QR payments जल्दी `payment_received` बनें. Server polling भी backup verification करता है.
