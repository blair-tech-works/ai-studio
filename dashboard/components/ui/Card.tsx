import { HTMLAttributes, forwardRef } from 'react';

interface Props extends HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
  selected?: boolean;
}

const Card = forwardRef<HTMLDivElement, Props>(function Card(
  { hoverable = false, selected = false, className = '', children, ...rest },
  ref
) {
  const borderClass = selected
    ? 'border-accent-500'
    : hoverable
    ? 'border-border-subtle hover:border-border-strong'
    : 'border-border-subtle';

  return (
    <div
      ref={ref}
      {...rest}
      className={`bg-surface border ${borderClass} rounded-lg transition-colors duration-150 ${className}`}
    >
      {children}
    </div>
  );
});

export default Card;
