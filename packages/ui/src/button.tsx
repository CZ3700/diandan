import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export const buttonVariants = cva("fs-button", {
  variants: {
    size: {
      compact: "fs-button--compact",
      icon: "fs-button--icon",
      standard: "fs-button--standard",
    },
    variant: {
      danger: "fs-button--danger",
      primary: "fs-button--primary",
      quiet: "fs-button--quiet",
      secondary: "fs-button--secondary",
    },
  },
  defaultVariants: {
    size: "standard",
    variant: "primary",
  },
});

export interface ButtonProps
  extends
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "style">,
    VariantProps<typeof buttonVariants> {
  children: ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      children,
      className,
      disabled = false,
      loading = false,
      size,
      type = "button",
      variant,
      ...props
    },
    ref,
  ) {
    return (
      <button
        {...props}
        ref={ref}
        aria-busy={loading || undefined}
        className={buttonVariants({ className, size, variant })}
        data-loading={loading || undefined}
        disabled={disabled || loading}
        type={type}
      >
        {loading ? (
          <span aria-hidden="true" className="fs-button__spinner" />
        ) : null}
        <span className="fs-button__label">{children}</span>
      </button>
    );
  },
);
