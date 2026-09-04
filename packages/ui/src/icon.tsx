import { forwardRef, type ReactElement } from "react";

export type IconName =
  | "arrow-left"
  | "arrow-right"
  | "check"
  | "chevron-down"
  | "close"
  | "minus"
  | "plus"
  | "shopping-bag"
  | "warning";

interface IconBaseProps {
  className?: string;
  name: IconName;
}

interface DecorativeIconProps extends IconBaseProps {
  decorative: true;
  label?: never;
}

interface InformativeIconProps extends IconBaseProps {
  decorative?: false;
  label: string;
}

export type IconProps = DecorativeIconProps | InformativeIconProps;

function glyph(name: IconName): ReactElement {
  switch (name) {
    case "arrow-left":
      return <path d="m15 18-6-6 6-6M9 12h10" />;
    case "arrow-right":
      return <path d="m9 6 6 6-6 6m6-6H5" />;
    case "check":
      return <path d="m5 12 4 4L19 6" />;
    case "chevron-down":
      return <path d="m6 9 6 6 6-6" />;
    case "close":
      return <path d="M6 6l12 12M18 6 6 18" />;
    case "minus":
      return <path d="M5 12h14" />;
    case "plus":
      return <path d="M12 5v14M5 12h14" />;
    case "shopping-bag":
      return <path d="M6 8h12l-1 12H7L6 8Zm3 0V6a3 3 0 0 1 6 0v2" />;
    case "warning":
      return (
        <>
          <path d="M12 3 2.5 20h19L12 3Z" />
          <path d="M12 9v4m0 3h.01" />
        </>
      );
  }
}

export const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(
  { className, decorative = false, label, name },
  ref,
) {
  if (!decorative && (label === undefined || label.trim().length === 0)) {
    throw new TypeError("Informative icons require a non-empty label.");
  }

  return (
    <svg
      ref={ref}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label}
      className={className === undefined ? "fs-icon" : `fs-icon ${className}`}
      fill="none"
      focusable="false"
      role={decorative ? undefined : "img"}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
    >
      {glyph(name)}
    </svg>
  );
});
