import 'leaflet/dist/leaflet.css';
import './globals.css';

export const metadata = {
  title: 'SaleHop — Find & Post Garage Sales',
  description: 'Find garage sales near you and plan your Saturday route. Post your own sale in minutes.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'SaleHop',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#201C16',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
