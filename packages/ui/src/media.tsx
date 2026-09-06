"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";

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
  const imageRef = useRef<HTMLImageElement>(null);
  const [failedResourceIdentity, setFailedResourceIdentity] = useState<
    string | null
  >(null);
  const alternative = resolveMediaAlternative(props);
  const resourceIdentity = createMediaResourceIdentity(props);

  useEffect(() => {
    const image = imageRef.current;
    if (image?.complete === true && image.naturalWidth === 0) {
      setFailedResourceIdentity(resourceIdentity);
    }
  }, [resourceIdentity]);

  return (
    <MediaFrame
      {...props}
      alternative={alternative}
      failed={failedResourceIdentity === resourceIdentity}
      failureOrigin="runtime"
      imageRef={imageRef}
      onError={() => setFailedResourceIdentity(resourceIdentity)}
      onLoad={() => setFailedResourceIdentity(null)}
    />
  );
}
