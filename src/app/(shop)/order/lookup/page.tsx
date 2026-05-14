import { Container } from '@/components/layout/Container';
import { OrderLookupClient } from './OrderLookupClient';
import { getTranslations } from 'next-intl/server';

export default async function OrderLookupPage() {
  const t = await getTranslations('order.lookup');

  return (
    <Container size="sm" className="py-10">
      <h1 className="text-xl font-bold mb-4">{t('title')}</h1>
      <OrderLookupClient />
    </Container>
  );
}
