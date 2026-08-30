import QRCode from 'qrcode';
import { getSaleForShare } from '@/lib/getSaleForShare';
import { SITE_URL } from '@/lib/site';
import SignBuilder from './SignBuilder';
import SignBodyClass from './SignBodyClass';

// A print-friendly yard sign for one approved sale: big title, address,
// date/time, and a QR code straight to this sale's real listing page
// (/listing/[id]) so anyone walking or driving by can pull up photos and
// directions on their own phone. Reuses getSaleForShare -- the same
// anon-key, "approved only" lookup the share page already uses -- so a
// listing still awaiting review has nothing to print here yet.
export async function generateMetadata() {
  return { title: 'Printable Sign — SaleHop' };
}

export default async function SignPage({ params }) {
  const sale = await getSaleForShare(params.id);

  if (!sale) {
    return (
      <>
        <SignBodyClass />
        <div className="sign-page-notfound">
          <p>This listing isn&apos;t available to print a sign for — it may have been removed or isn&apos;t approved yet.</p>
        </div>
      </>
    );
  }

  const listingUrl = `${SITE_URL}/listing/${sale.id}`;
  // Generated server-side as inline SVG (not a canvas/PNG) -- crisp at any
  // print size, no image file to host, and works the same in the Vercel
  // serverless runtime as it does locally.
  const qrSvg = await QRCode.toString(listingUrl, {
    type: 'svg',
    margin: 1,
    width: 220,
    color: { dark: '#201C16', light: '#FFFFFF' },
  });

  return (
    <>
      <SignBodyClass />
      <div className="sign-page">
        <SignBuilder sale={sale} qrSvg={qrSvg} />
      </div>
    </>
  );
}
