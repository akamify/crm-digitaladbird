'use client';
import { forwardRef, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react';
import { clsx } from '@/lib/format';

interface FieldShell {
  label?: string;
  error?: string;
  hint?: string;
  required?: boolean;
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement>, FieldShell {
  leftIcon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, required, leftIcon, className, id, ...rest }, ref,
) {
  const eid = id || rest.name;
  return (
    <div className="w-full">
      {label && <label htmlFor={eid} className="label">{label}{required && <span className="text-brand-500"> *</span>}</label>}
      <div className="relative">
        {leftIcon && <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">{leftIcon}</span>}
        <input
          ref={ref}
          id={eid}
          className={clsx('input', !!leftIcon && 'pl-10', error && 'border-red-500/60', className)}
          {...rest}
        />
      </div>
      {error  ? <p className="mt-1 text-xs text-red-400">{error}</p>
            : hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
});

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, FieldShell {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, hint, required, className, id, ...rest }, ref,
) {
  const eid = id || rest.name;
  return (
    <div className="w-full">
      {label && <label htmlFor={eid} className="label">{label}{required && <span className="text-brand-500"> *</span>}</label>}
      <textarea
        ref={ref}
        id={eid}
        className={clsx('input min-h-[88px] py-2.5', error && 'border-red-500/60', className)}
        {...rest}
      />
      {error  ? <p className="mt-1 text-xs text-red-400">{error}</p>
            : hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
});

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement>, FieldShell {
  options: { value: string; label: string }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, hint, required, options, placeholder, className, id, ...rest }, ref,
) {
  const eid = id || rest.name;
  return (
    <div className="w-full">
      {label && <label htmlFor={eid} className="label">{label}{required && <span className="text-brand-500"> *</span>}</label>}
      <select
        ref={ref}
        id={eid}
        className={clsx('input appearance-none pr-9 bg-no-repeat bg-[right_0.75rem_center]', error && 'border-red-500/60', className)}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path fill='%2394a3b8' d='M6 8L2 4h8z'/></svg>\")",
        }}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error  ? <p className="mt-1 text-xs text-red-400">{error}</p>
            : hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
});
