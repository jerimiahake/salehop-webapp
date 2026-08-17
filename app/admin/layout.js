import AdminBodyClass from './AdminBodyClass';

export const metadata = {
  title: 'SaleHop Admin',
};

export default function AdminLayout({ children }) {
  return (
    <>
      <AdminBodyClass />
      {children}
    </>
  );
}
