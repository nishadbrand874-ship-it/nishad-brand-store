# NISHAD BRAND — Security Hardened V44

This version hardens the existing store without putting inventory credentials in frontend HTML/JS.

## Main protections
- Inventory ID/password/extra fields remain encrypted at rest with `INVENTORY_ENCRYPTION_KEY`.
- Public API never returns the inventory list or decrypted inventory records.
- New customer orders receive a random 256-bit order session token; QR status and UTR submission require that token.
- Public order checking is by UTR / Transaction ID and is rate-limited.
- Admin login has per-IP + username brute-force protection.
- Admin session cookie is HttpOnly, Secure in production, SameSite=Strict and expires after 2 hours.
- Production requires strong `JWT_SECRET`, `ADMIN_PASSWORD`, and `INVENTORY_ENCRYPTION_KEY` values.
- Security headers include CSP, HSTS (production), frame protection, MIME sniffing protection, referrer policy and permissions policy.
- Public order responses do not expose UTR/payment identifiers unnecessarily.
- Order IDs use a timestamp plus cryptographically random bytes instead of `Math.random()`.
- Inventory upload is capped at 500 records per request.
- Sensitive API responses are sent with no-cache headers where appropriate.

## Important limitation
No website can honestly guarantee that it is impossible to hack. Also, frontend HTML/CSS/JS can always be inspected in browser DevTools. The security goal is that **database credentials, encryption keys and server-side secrets are not exposed there**, and sensitive operations are enforced by the server.

## Render environment variables
Keep these only in Render Environment Variables, never in the ZIP/repository:
- `DATABASE_URL`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `JWT_SECRET`
- `INVENTORY_ENCRYPTION_KEY`
- `UPI_VPA`

`INVENTORY_ENCRYPTION_KEY` must remain stable. Do not change it after encrypted inventory exists unless you perform a controlled key rotation/migration.

## V44.1 database compatibility fix

Added a startup migration that creates `orders.qr_code_id` on existing databases when the column is missing. This fixes the production error `column "qr_code_id" of relation "orders" does not exist` without requiring existing order data to be recreated.
