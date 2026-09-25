import type { ReactElement, ReactNode } from "react";

import { Icon } from "./icon.js";

export type HeroEntranceProps = Readonly<{
  children: ReactElement;
}>;

export function HeroEntrance({ children }: HeroEntranceProps): ReactElement {
  return (
    <div
      className="fs-motion-hero"
      data-fs-motion="hero-entrance"
      data-motion-token="--motion-hero-effective"
    >
      {children}
    </div>
  );
}

export type SuccessRevealProps = Readonly<{
  children?: ReactNode;
  description?: string;
  status: "confirmed";
  title: string;
}>;

export function SuccessReveal({
  children,
  description,
  status,
  title,
}: SuccessRevealProps): ReactElement {
  if (title.trim().length === 0) {
    throw new TypeError("Success reveal title must be non-empty.");
  }
  if (description !== undefined && description.trim().length === 0) {
    throw new TypeError("Success reveal description must be non-empty.");
  }

  return (
    <section
      className="fs-motion-success"
      data-fs-motion="success-reveal"
      data-motion-token="--motion-hero-effective"
      data-order-status={status}
    >
      <span aria-hidden="true" className="fs-motion-success__marker">
        <Icon decorative name="check" />
      </span>
      <div className="fs-motion-success__body">
        <h2 className="fs-motion-success__title">{title}</h2>
        {description === undefined ? null : (
          <p className="fs-motion-success__description">{description}</p>
        )}
        {children === undefined ? null : (
          <div className="fs-motion-success__details">{children}</div>
        )}
      </div>
    </section>
  );
}
