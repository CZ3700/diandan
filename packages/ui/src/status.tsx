import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

export const statusVariants = cva("fs-status", {
  variants: {
    tone: {
      danger: "fs-status--danger",
      neutral: "fs-status--neutral",
      success: "fs-status--success",
      warning: "fs-status--warning",
    },
  },
  defaultVariants: {
    tone: "neutral",
  },
});

export type StatusTone = NonNullable<
  VariantProps<typeof statusVariants>["tone"]
>;

export interface StatusProps
  extends
    Omit<HTMLAttributes<HTMLSpanElement>, "children" | "style">,
    VariantProps<typeof statusVariants> {
  children: ReactNode;
}

export const Status = forwardRef<HTMLSpanElement, StatusProps>(function Status(
  { children, className, tone, ...props },
  ref,
) {
  return (
    <span {...props} ref={ref} className={statusVariants({ className, tone })}>
      {children}
    </span>
  );
});
