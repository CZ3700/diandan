"use client";

import { useEffect, useState } from "react";
import { Button } from "@fan-support/ui";
import type { StorefrontCopy } from "./copy";

/** A local pause control for the photo's decorative layer, never the photo itself. */
export function HeroMotion({
  copy,
}: Readonly<{
  copy: Pick<StorefrontCopy, "heroPauseMotion" | "heroPlayMotion">;
}>) {
  const [playback, setPlayback] = useState<"idle" | "playing" | "paused">(
    "idle",
  );
  // Do not start continuous motion until its pause control can respond.
  useEffect(() => setPlayback("playing"), []);
  return (
    <div className="storefront-hero-motion" data-hero-motion={playback}>
      <div className="storefront-hero-sparkles" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
      <Button
        className="storefront-hero-motion-control"
        size="compact"
        variant="secondary"
        onClick={() =>
          setPlayback((current) =>
            current === "playing" ? "paused" : "playing",
          )
        }
      >
        {playback === "paused" ? copy.heroPlayMotion : copy.heroPauseMotion}
      </Button>
    </div>
  );
}
