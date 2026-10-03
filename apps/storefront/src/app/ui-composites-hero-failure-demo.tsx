"use client";

import { Button } from "@fan-support/ui";
import {
  Hero,
  type CompositeResponsiveMedia,
} from "@fan-support/ui/composites";
import { useState, type ReactElement } from "react";

export function UiCompositesHeroFailureDemo({
  actionLabel,
  description,
  eyebrow,
  failedMedia,
  heading,
  readyMedia,
}: Readonly<{
  actionLabel: string;
  description: string;
  eyebrow: string;
  failedMedia: CompositeResponsiveMedia;
  heading: string;
  readyMedia: CompositeResponsiveMedia;
}>): ReactElement {
  const [failureRequested, setFailureRequested] = useState(false);

  return (
    <div data-hero-failure-demo={failureRequested ? "requested" : "ready"}>
      <Hero
        action={{ href: "#catalog", label: actionLabel }}
        description={description}
        eyebrow={eyebrow}
        heading={heading}
        media={failureRequested ? failedMedia : readyMedia}
        state="ready"
        textTone="light"
      />
      <Button
        data-hero-failure-trigger="true"
        disabled={failureRequested}
        lang="en"
        onClick={() => setFailureRequested(true)}
        variant="secondary"
      >
        {/* One label: a longer "requested" text wrapped at narrow widths and moved the page below the Hero. */}
        Trigger runtime image failure
      </Button>
    </div>
  );
}
