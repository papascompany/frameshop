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
 *
 *  Nike vocabulary (DESIGN-nike.md `filter-chip` + `filter-chip-active`):
 *   - Default chip: bg-canvas, text-ink, 1px hairline border, pill (30px).
 *   - Active chip: bg-ink, text-on-primary (fully inverted) — no middle state.
 *
 *  Horizontal scroll on mobile; row layout on desktop. Touch targets are
 *  ≥ 44px tall.
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
        <p className="body-strong text-ink">{label}</p>
      ) : null}
      <div
        role="radiogroup"
        aria-label={ariaLabel ?? label}
        className="flex gap-2 overflow-x-auto pb-1"
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
                'min-h-[44px] px-4 text-sm whitespace-nowrap font-medium',
                'rounded-[30px] transition-colors duration-150',
                'tap-collapse',
                selected
                  ? 'bg-ink text-on-primary border border-ink'
                  : 'bg-canvas text-ink border border-hairline hover:border-ink',
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
