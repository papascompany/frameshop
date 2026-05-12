'use client';

import { createContext, useContext, useId } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Ctx = {
  value: string;
  onChange: (next: string) => void;
  baseId: string;
};
const TabsCtx = createContext<Ctx | null>(null);

function useTabsCtx() {
  const ctx = useContext(TabsCtx);
  if (!ctx) throw new Error('Tabs.* used outside <Tabs.Root>');
  return ctx;
}

export function TabsRoot({
  value,
  onChange,
  children,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  children: ReactNode;
  className?: string;
}) {
  const baseId = useId();
  return (
    <TabsCtx.Provider value={{ value, onChange, baseId }}>
      <div className={cn('flex flex-col gap-3', className)}>{children}</div>
    </TabsCtx.Provider>
  );
}

export function TabsList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex w-full overflow-x-auto border-b border-border',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value: tabValue,
  children,
  disabled,
}: {
  value: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  const { value, onChange, baseId } = useTabsCtx();
  const selected = value === tabValue;
  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${tabValue}`}
      aria-controls={`${baseId}-panel-${tabValue}`}
      aria-selected={selected}
      disabled={disabled}
      onClick={() => onChange(tabValue)}
      className={cn(
        'px-4 py-3 text-sm font-medium whitespace-nowrap relative',
        'transition-colors duration-150',
        selected ? 'text-foreground' : 'text-muted-fg hover:text-foreground',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      {children}
      {selected ? (
        <span
          aria-hidden
          className="absolute left-0 right-0 -bottom-px h-[2px] bg-foreground"
        />
      ) : null}
    </button>
  );
}

export function TabsPanel({
  value: tabValue,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  const { value, baseId } = useTabsCtx();
  if (value !== tabValue) return null;
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${tabValue}`}
      aria-labelledby={`${baseId}-tab-${tabValue}`}
    >
      {children}
    </div>
  );
}

export const Tabs = {
  Root: TabsRoot,
  List: TabsList,
  Trigger: TabsTrigger,
  Panel: TabsPanel,
};
