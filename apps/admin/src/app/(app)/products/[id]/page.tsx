'use client';

import { useParams } from 'next/navigation';
import { ProductEditor } from '@/components/catalog/product-editor';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <ProductEditor productId={id} />;
}
