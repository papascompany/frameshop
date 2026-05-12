'use client';

import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string;
  hint?: string;
  endAdornment?: ReactNode;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, endAdornment, className, id, ...rest },
  ref,
) {
  const reactId = useId();
  const inputId = id ?? `in-${reactId}`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-err`;

  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={inputId} className="text-sm font-medium text-foreground">
          {label}
        </label>
      ) : null}
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={cn(hint && hintId, error && errorId) || undefined}
          className={cn(
            'h-11 w-full bg-surface text-foreground placeholder:text-muted-fg',
            'border border-border rounded-input px-3',
            'transition-colors duration-150',
            'focus:outline-none focus:border-foreground',
            error && 'border-danger focus:border-danger',
            endAdornment && 'pr-12',
            className,
          )}
          {...rest}
        />
        {endAdornment ? (
          <div className="absolute inset-y-0 right-0 flex items-center pr-2">
            {endAdornment}
          </div>
        ) : null}
      </div>
      {hint && !error ? (
        <p id={hintId} className="text-xs text-muted-fg">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
});
