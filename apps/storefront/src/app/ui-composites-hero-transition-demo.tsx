"use client";

import { Button } from "@fan-support/ui";
import {
  Hero,
  type CompositeResponsiveMedia,
} from "@fan-support/ui/composites";
import { useState, type ReactElement } from "react";

export function UiCompositesHeroTransitionDemo({
  actionLabel,
  description,
  eyebrow,
  heading,
  loadingLabel,
  media,
}: Readonly<{
  actionLabel: string;
  description: string;
  eyebrow: string;
  heading: string;
  loadingLabel: string;
  media: CompositeResponsiveMedia;
}>): ReactElement {
  const [ready, setReady] = useState(false);

  return (
    <div data-hero-transition-demo={ready ? "ready" : "loading"}>
      {ready ? (
        <Hero
          action={{ href: "#catalog", label: actionLabel }}
          description={description}
          eyebrow={eyebrow}
          heading={heading}
          media={media}
          state="ready"
          textTone="light"
        />
      ) : (
        <Hero label={loadingLabel} state="loading" />
      )}
      <Button
        data-hero-transition-trigger="true"
        disabled={ready}
        lang="en"
        onClick={() => setReady(true)}
        variant="secondary"
      >
        {ready ? "Hero loading state resolved" : "Resolve Hero loading state"}
      </Button>
    </div>
  );
}
