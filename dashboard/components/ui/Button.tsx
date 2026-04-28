import { ButtonHTMLAttributes, forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-accent-500 text-canvas hover:bg-accent-600 font-medium',
  secondary:
    'bg-transparent text-text-primary border border-border-subtle hover:bg-elevated hover:border-border-strong',
  danger:
    'bg-red-500/10 text-red-300 border border-red-500/30 hover:bg-red-500/20 hover:border-red-500/50',
  ghost: 'bg-transparent text-text-secondary hover:bg-elevated hover:text-text-primary'
};

const sizeClasses: Record<Size, string> = {
  sm: 'px-2.5 py-1 text-xs rounded-md',
  md: 'px-3 py-1.5 text-sm rounded-md'
};

const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'secondary', size = 'md', className = '', children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      {...rest}
      className={`inline-flex items-center gap-1.5 transition-colors duration-150 focus-ring disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
    >
      {children}
    </button>
  );
});

export default Button;
