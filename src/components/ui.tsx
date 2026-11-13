import type { ComponentProps } from 'react';

export const Surface = ({
  inset = false,
  className = '',
  ...props
}: ComponentProps<'div'> & { inset?: boolean }) => (
  <div
    className={`min-w-0 [:where(&)]:rounded-card [:where(&)]:text-foreground ${
      inset
        ? '[:where(&)]:bg-background [:where(&)]:border [:where(&)]:border-border'
        : '[:where(&)]:bg-surface [:where(&)]:border [:where(&)]:border-border [:where(&)]:shadow-surface'
    } ${className}`}
    {...props}
  />
);

const buttonTones = {
  primary:
    '[:where(&)]:bg-primary [:where(&)]:text-primary-foreground hover:brightness-95',
  quiet:
    '[:where(&)]:border [:where(&)]:border-border [:where(&)]:bg-surface [:where(&)]:text-foreground hover:bg-background',
  ghost:
    '[:where(&)]:bg-transparent [:where(&)]:text-muted hover:text-foreground hover:bg-surface/70',
  accent:
    '[:where(&)]:bg-accent [:where(&)]:text-accent-foreground hover:brightness-95',
};

export const Button = ({
  tone = 'primary',
  type = 'button',
  className = '',
  ...props
}: ComponentProps<'button'> & { tone?: keyof typeof buttonTones }) => (
  <button
    type={type}
    className={`[:where(&)]:inline-flex [:where(&)]:min-h-10 [:where(&)]:items-center [:where(&)]:justify-center [:where(&)]:gap-2 whitespace-nowrap [:where(&)]:rounded-control [:where(&)]:px-3.5 [:where(&)]:text-sm [:where(&)]:font-medium transition-[color,background-color,border-color,transform,opacity] duration-150 ease-out active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50 ${buttonTones[tone]} ${className}`}
    {...props}
  />
);

export const Field = ({
  label,
  hint,
  error,
  id,
  className = '',
  ...props
}: ComponentProps<'input'> & {
  label: string;
  hint?: string;
  error?: string;
}) => {
  const inputId = id || label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return (
    <div className="min-w-0 space-y-1.5">
      <label
        htmlFor={inputId}
        className="block text-sm font-medium text-foreground"
      >
        {label}
      </label>
      <input
        id={inputId}
        className={`w-full min-h-11 rounded-control border border-border bg-surface px-3.5 text-sm text-foreground placeholder:text-muted/70 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${className}`}
        {...props}
      />
      {error ? (
        <p role="alert" className="text-xs text-accent">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
};
