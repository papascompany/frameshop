import { Container } from '@/components/layout/Container';
import { getShippingMethods } from '@/lib/db/shipping';
import { CheckoutClient } from './CheckoutClient';
import { getTranslations } from 'next-intl/server';

export default async function CheckoutPage() {
  let methods: Awaited<ReturnType<typeof getShippingMethods>> = [];
  try {
    methods = await getShippingMethods();
  } catch (err) {
    console.warn('shipping methods fetch failed:', err);
  }
  const t = await getTranslations('checkout');
  return (
    <Container size="md" className="py-6 md:py-10">
      <h1 className="text-xl md:text-2xl font-bold mb-4">{t('title')}</h1>
      <CheckoutClient shippingMethods={methods} />
    </Container>
  );
}
