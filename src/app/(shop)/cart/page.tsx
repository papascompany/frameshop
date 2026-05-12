import { CartClient } from './CartClient';

export default function CartPage() {
  // Client-only — cart for anon users lives entirely in LocalStorage.
  return <CartClient />;
}
