"use client";

import type { ReactElement } from "react";

export type LiveRegionProps = Readonly<{
  message: string;
  politeness?: "assertive" | "polite";
}>;

export function LiveRegion({
  message,
  politeness = "polite",
}: LiveRegionProps): ReactElement {
  return (
    <div
      aria-atomic="true"
      aria-live={politeness}
      className="fs-live-region"
      role={politeness === "assertive" ? "alert" : "status"}
    >
      {message}
    </div>
  );
}
