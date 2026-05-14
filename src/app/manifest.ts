import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FrameShop — 사진 액자 주문',
    short_name: 'FrameShop',
    description: '당신의 사진을 아름다운 액자로. 온라인 주문, 고화질 인쇄, 빠른 배송.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#2A2A2A',
    lang: 'ko',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
