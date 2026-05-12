import { Container } from './Container';

export function Footer() {
  return (
    <footer className="mt-auto bg-surface-muted border-t border-border">
      <Container size="xl" className="py-8 text-xs text-muted-fg">
        <div className="flex flex-col gap-2 md:flex-row md:justify-between">
          <div>
            <p className="font-semibold text-foreground mb-1">FrameShop</p>
            <p>당신의 사진이 작품이 됩니다.</p>
          </div>
          <div className="flex flex-col gap-1 md:items-end">
            <p>© {new Date().getFullYear()} FrameShop. All rights reserved.</p>
            <p>고객센터 평일 10:00 – 18:00</p>
          </div>
        </div>
      </Container>
    </footer>
  );
}
