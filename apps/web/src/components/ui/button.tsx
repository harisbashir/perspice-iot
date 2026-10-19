import { Slot } from '@radix-ui/react-slot';
import { type VariantProps, cva } from 'class-variance-authority';
import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

// Sizes grow to 44 px on touch screens (HIG › Accessibility: 44×44 pt controls).
export const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-[background-color,color,opacity,transform] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        default: 'bg-primary-600 text-white shadow-sm hover:bg-primary-700',
        destructive: 'bg-red-600 text-white shadow-sm hover:bg-red-700',
        /** A quiet grey button (the name predates the redesign; there is no border). */
        outline: 'bg-fill text-fg hover:bg-fill-strong',
        /** Tinted with the brand colour, for secondary actions that still lead somewhere. */
        secondary: 'bg-primary-500/10 text-primary-700 hover:bg-primary-500/15 dark:bg-primary-400/15 dark:text-primary-200 dark:hover:bg-primary-400/25',
        ghost: 'text-fg-2 hover:bg-fill hover:text-fg',
        link: 'text-primary-700 underline-offset-4 hover:underline dark:text-primary-300',
      },
      size: {
        default: 'h-9 px-4 touch:h-11',
        sm: 'h-8 px-3 text-[13px] touch:h-10',
        lg: 'h-11 px-6 text-[15px]',
        icon: 'h-9 w-9 touch:h-11 touch:w-11',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = 'Button';
