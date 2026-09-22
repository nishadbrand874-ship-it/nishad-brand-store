# Direct UPI next test

This build makes the Direct App button use the browser's native user-click navigation
to the UPI URI and removes the optional `tn` field from the URI.

The generated URI is:
upi://pay?pa=<VPA>&pn=<PAYEE>&am=<AMOUNT>&cu=INR

This does not bypass bank/UPI security checks.

If the same security decline still occurs while a manual payment to the same VPA
works, the remaining issue is outside the web Intent formatting (for example
merchant/P2M eligibility or risk policy). In that case use a properly onboarded
merchant UPI ID/QR from the acquiring bank.
