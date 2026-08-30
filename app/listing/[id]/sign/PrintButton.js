'use client';

// Kept as its own tiny client component because the sign page itself is a
// server component (it needs to await the QR code generation) -- and
// window.print() only exists in the browser.
export default function PrintButton() {
  return (
    <button type="button" className="sign-print-btn no-print" onClick={() => window.print()}>
      🖨️ Print This Sign
    </button>
  );
}
