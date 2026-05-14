import { ImageResponse } from 'next/og';

export const alt = 'FrameShop — 사진을 작품으로';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#2A2A2A',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          color: 'white',
        }}
      >
        <div
          style={{
            fontSize: 80,
            fontWeight: 700,
            letterSpacing: '-2px',
          }}
        >
          FrameShop
        </div>
        <div
          style={{
            fontSize: 32,
            marginTop: 20,
            color: '#cccccc',
          }}
        >
          사진을 작품으로
        </div>
      </div>
    ),
    { ...size },
  );
}
