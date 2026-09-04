import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from "react";

export const linkVariants = cva("fs-link", {
  variants: {
    variant: {
      inline: "fs-link--inline",
      muted: "fs-link--muted",
      standalone: "fs-link--standalone",
    },
  },
  defaultVariants: {
    variant: "inline",
  },
});

export interface LinkProps
  extends
    Omit<
      AnchorHTMLAttributes<HTMLAnchorElement>,
      "children" | "href" | "style"
    >,
    VariantProps<typeof linkVariants> {
  children: ReactNode;
  href: string;
}

function secureRel(target: LinkProps["target"], rel: LinkProps["rel"]) {
  if (target?.toLowerCase() !== "_blank") {
    return rel;
  }

  const tokens = rel?.split(/\s+/u).filter(Boolean) ?? [];
  for (const requiredToken of ["noopener", "noreferrer"] as const) {
    if (!tokens.some((token) => token.toLowerCase() === requiredToken)) {
      tokens.push(requiredToken);
    }
  }
  return tokens.join(" ");
}

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { children, className, href, rel, target, variant, ...props },
  ref,
) {
  if (href.trim().length === 0) {
    throw new TypeError("Link requires a non-empty href.");
  }

  return (
    <a
      {...props}
      ref={ref}
      className={linkVariants({ className, variant })}
      href={href}
      rel={secureRel(target, rel)}
      target={target}
    >
      {children}
    </a>
  );
});
