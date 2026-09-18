# V44.70 — Instant UTR Mismatch Auto Reject

- Customer submits a UTR on the website.
- Merchant Verify app reports the real SMS UTR + exact amount.
- If the exact UTR is not found and there is exactly one recent pending order for the same amount, the order is immediately marked `rejected` with `merchant_app_utr_mismatch`.
- The storefront polling detects `rejected` and immediately shows **PAYMENT REJECTED**.
- No inventory is released for a mismatched UTR.
- If multiple pending orders have the same amount, the server does not guess and does not auto-reject them; this prevents one customer's SMS from incorrectly rejecting another customer's order.
