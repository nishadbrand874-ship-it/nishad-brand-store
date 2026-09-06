# NISHAD BRAND — Live Payment Setup

## 1. Render Environment Variables

Set these in the Render Web Service:

- `DATABASE_URL` = your Render PostgreSQL Internal Database URL
- `DATABASE_SSL` = `true`
- `ADMIN_USERNAME` = your admin username
- `ADMIN_PASSWORD` = a strong admin password
- `JWT_SECRET` = a long random secret
- `RAZORPAY_KEY_ID` = your Razorpay Live Key ID
- `RAZORPAY_KEY_SECRET` = your Razorpay Live Key Secret
- `RAZORPAY_WEBHOOK_SECRET` = a webhook secret you create yourself
- `NODE_ENV` = `production`

Do not put the Razorpay secret in frontend code.

## 2. Razorpay Dashboard

Create a Live webhook pointing to:

`https://YOUR-RENDER-DOMAIN/api/payment/webhook`

Use the SAME value as `RAZORPAY_WEBHOOK_SECRET`.

Enable at least:
- `payment.captured`
- `payment.failed`
- `order.paid`

## 3. Automatic fulfilment

Customer clicks Buy Now -> server creates a Razorpay Order -> Razorpay Checkout -> server verifies the Checkout signature -> server fetches the payment -> verifies order ID, INR amount and `captured` status -> inventory is assigned atomically.

Webhook is also verified using the raw request body and webhook secret. Duplicate webhook events are safe because fulfilment checks the order state inside a database transaction.

## 4. Important

The uploaded static UPI QR cannot by itself provide reliable automatic payment verification. Automatic verification is therefore performed through Razorpay Checkout + server verification + webhook. The QR remains in Admin as a configurable reference image.
