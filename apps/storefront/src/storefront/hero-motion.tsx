"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { StorefrontCopy } from "./copy";

/** Keeps the photo, reading area and local motion control in one responsive composition. */
export function HeroMotion({
  copy,
  children,
  action,
  image,
}: Readonly<{
  copy: Pick<StorefrontCopy, "heroPauseMotion" | "heroPlayMotion">;
  children?: ReactNode;
  action?: ReactNode;
  image?: ReactNode;
}>) {
  const [playback, setPlayback] = useState<"idle" | "playing" | "paused">(
    "idle",
  );
  // Continuous decoration starts only when its pause control can respond.
  useEffect(() => setPlayback("playing"), []);
  return (
    <section
      className="storefront-hero"
      data-home-hero="true"
      data-hero-motion={playback}
      aria-labelledby="hero-title"
    >
      <div className="storefront-hero-copy">
        {children}
        <div className="storefront-hero-actions">
          {action}
          <button
            type="button"
            className="storefront-hero-motion-control"
            aria-label={
              playback === "paused" ? copy.heroPlayMotion : copy.heroPauseMotion
            }
            onClick={() =>
              setPlayback((current) =>
                current === "playing" ? "paused" : "playing",
              )
            }
          >
            <span className="storefront-hero-motion-dot" aria-hidden="true" />
          </button>
        </div>
      </div>
      {image}
    </section>
  );
}

/** All presets share the same static photo and SSR-safe, bounded decorative layers. */
export function HeroMotionLayer() {
  return (
    <div className="storefront-hero-motion" aria-hidden="true">
      {(
        [
          ["STARLIGHT", 12],
          ["AURORA", 3],
          ["SPOTLIGHT", 3],
          ["PETALS", 10],
        ] as const
      ).map(([effect, count]) => (
        <div key={effect} data-hero-layer={effect}>
          {Array.from({ length: count }, (_, index) => (
            <span key={index} />
          ))}
        </div>
      ))}
    </div>
  );
}
