import { HTMLAttributes } from 'react';

type Variant = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'purple';

interface Props extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
  dot?: boolean;
  uppercase?: boolean;
}

const variantClasses: Record<Variant, { bg: string; text: string; border: string; dot: string }> = {
  neutral: {
    bg: 'bg-elevated',
    text: 'text-text-secondary',
    border: 'border-border-subtle',
    dot: 'bg-text-secondary'
  },
  accent: {
    bg: 'bg-accent-500/10',
    text: 'text-accent-300',
    border: 'border-accent-500/30',
    dot: 'bg-accent-400'
  },
  success: {
    bg: 'bg-green-500/10',
    text: 'text-green-300',
    border: 'border-green-500/30',
    dot: 'bg-green-400'
  },
  warning: {
    bg: 'bg-yellow-500/10',
    text: 'text-yellow-300',
    border: 'border-yellow-500/30',
    dot: 'bg-yellow-400'
  },
  danger: {
    bg: 'bg-red-500/10',
    text: 'text-red-300',
    border: 'border-red-500/30',
    dot: 'bg-red-400'
  },
  info: {
    bg: 'bg-blue-500/10',
    text: 'text-blue-300',
    border: 'border-blue-500/30',
    dot: 'bg-blue-400'
  },
  purple: {
    bg: 'bg-purple-500/10',
    text: 'text-purple-300',
    border: 'border-purple-500/30',
    dot: 'bg-purple-400'
  }
};

export default function Badge({
  variant = 'neutral',
  dot = false,
  uppercase = false,
  className = '',
  children,
  ...rest
}: Props) {
  const v = variantClasses[variant];
  return (
    <span
      {...rest}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border ${v.bg} ${v.text} ${v.border} ${uppercase ? 'uppercase tracking-wider' : ''} ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${v.dot}`} />}
      {children}
    </span>
  );
}
