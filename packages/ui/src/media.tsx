"use client";

import { useState, type ReactElement } from "react";

import {
  createMediaResourceIdentity,
  MediaFrame,
  resolveMediaAlternative,
  type MediaProps,
} from "./media-frame.js";

export {
  createMediaResourceIdentity,
  MediaFallback,
  MediaFrame,
  resolveMediaAlternative,
  type MediaAlternativeInput,
  type MediaFocalPoint,
  type MediaFit,
  type MediaFrameProps,
  type MediaProps,
  type ResolvedMediaAlternative,
} from "./media-frame.js";

export function Media(props: MediaProps): ReactElement {
  const [failedResourceIdentity, setFailedResourceIdentity] = useState<
    string | null
  >(null);
  const alternative = resolveMediaAlternative(props);
  const resourceIdentity = createMediaResourceIdentity(props);

  return (
    <MediaFrame
      {...props}
      alternative={alternative}
      failed={failedResourceIdentity === resourceIdentity}
      failureOrigin="runtime"
      onError={() => setFailedResourceIdentity(resourceIdentity)}
      onLoad={() => setFailedResourceIdentity(null)}
    />
  );
}
