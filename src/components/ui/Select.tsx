'use client';

import { forwardRef, useId } from 'react';
import type { SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  error?: string;
  hint?: string;
  options: readonly SelectOption[];
  placeholder?: string;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, hint, options, placeholder, className, id, ...rest },
  ref,
) {
  const reactId = useId();
  const selId = id ?? `sel-${reactId}`;
  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={selId} className="text-sm font-medium text-foreground">
          {label}
        </label>
      ) : null}
      <select
        ref={ref}
        id={selId}
        aria-invalid={error ? true : undefined}
        className={cn(
          'h-11 w-full bg-surface text-foreground',
          'border border-border rounded-input px-3',
          'transition-colors duration-150',
          'focus:outline-none focus:border-foreground',
          error && 'border-danger focus:border-danger',
          className,
        )}
        {...rest}
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && !error ? (
        <p className="text-xs text-muted-fg">{hint}</p>
      ) : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
});
