'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { AdminSidebar } from './AdminSidebar';
import { AdminTopBar } from './AdminTopBar';
import { AdminMobileBottomNav } from './AdminMobileBottomNav';

type Props = {
  children: ReactNode;
};

export function AdminShell({ children }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-soft-cloud">
      {/* Sidebar */}
      <AdminSidebar
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />

      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0">
        <AdminTopBar onMenuClick={() => setDrawerOpen(true)} />

        {/* Content */}
        <main className="flex-1 p-4 md:p-6 lg:p-8 pb-20 md:pb-6 lg:pb-8">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <AdminMobileBottomNav />
    </div>
  );
}
