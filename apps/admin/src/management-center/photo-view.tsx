"use client";
/* Local blob previews and authorized processed media must bypass the public image optimizer. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import { Icon } from "@fan-support/ui";
export function PhotoView({
  src,
  alt,
  unavailable,
  lazy = false,
  referrerPolicy,
}: {
  src: string;
  alt: string;
  unavailable: string;
  lazy?: boolean;
  /** Signed private URLs must not carry the admin page as a referrer. */
  referrerPolicy?: "no-referrer";
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return failed ? (
    <span className="mc-photo-empty" role="img" aria-label={alt}>
      <Icon name="warning" decorative />
      <span>{unavailable}</span>
    </span>
  ) : (
    <img
      src={src}
      alt={alt}
      loading={lazy ? "lazy" : "eager"}
      referrerPolicy={referrerPolicy}
      onError={() => setFailed(true)}
    />
  );
}
