# NISHAD BRAND V44.2 – UTR Security Hardening

- UTR is validated server-side as 8–35 alphanumeric characters.
- The database unique index makes a UTR single-use across orders.
- Rejected UTRs cannot be resubmitted.
- Approved UTRs cannot be reused for another order.
- A race-condition on simultaneous duplicate UTR submissions returns a safe duplicate response.
- UTR submission remains manual-admin verification: this application does NOT claim to verify a bank/UPI payment merely from the UTR string. A real payment-status check requires a supported payment provider/bank API or manual admin verification.
- Order session token is still required to submit UTR for the QR order.
