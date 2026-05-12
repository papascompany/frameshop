'use client';

import { cn } from '@/lib/cn';

type Option = {
  value: string;
  label: string;
  disabled?: boolean;
};

type Props = {
  options: readonly Option[];
  value: string;
  onChange: (v: string) => void;
  label?: string;
  ariaLabel?: string;
};

/**
 * Segmented control for editor options (size / color / matte / paper).
 * Horizontal scroll on mobile, justified row on desktop.
 */
export function OptionTabs({
  options,
  value,
  onChange,
  label,
  ariaLabel,
}: Props) {
  return (
    <div className="flex flex-col gap-2">
      {label ? (
        <p className="text-sm font-medium text-foreground">{label}</p>
      ) : null}
      <div
        role="radiogroup"
        aria-label={ariaLabel ?? label}
        className="flex gap-2 overflow-x-auto"
      >
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={opt.disabled}
              onClick={() => onChange(opt.value)}
              className={cn(
                'min-h-[44px] px-4 py-2 text-sm whitespace-nowrap',
                'border transition-colors duration-150',
                selected
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-surface text-foreground hover:border-foreground',
                opt.disabled && 'opacity-40 cursor-not-allowed',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
