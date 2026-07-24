import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

type Variant = 'primary' | 'ghost' | 'subtle' | 'default';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'md' | 'lg';
  block?: boolean;
  iconOnly?: boolean;
}

const variantClass: Record<Variant, string> = {
  primary: styles.primary,
  ghost: styles.ghost,
  subtle: styles.subtle,
  default: '',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'default',
      size = 'md',
      block = false,
      iconOnly = false,
      className,
      type = 'button',
      children,
      ...rest
    },
    ref,
  ) => {
    const classes = [
      styles.button,
      variantClass[variant],
      size === 'lg' ? styles.lg : '',
      block ? styles.block : '',
      iconOnly ? styles.icon : '',
      className ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <button ref={ref} type={type} className={classes} {...rest}>
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';
