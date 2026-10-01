"use client";

import { useEffect, useId, useRef, useState } from "react";

export function ArtistDescription({
  text,
  lang,
  expandLabel,
  collapseLabel,
}: Readonly<{
  text: string;
  lang: string;
  expandLabel: string;
  collapseLabel: string;
}>) {
  const id = useId();
  const paragraph = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);

  useEffect(() => {
    const element = paragraph.current;
    if (!element) return;
    let active = true;
    const measure = () => {
      if (!active) return;
      // scrollHeight includes the clamped lines, and also works while expanded.
      const lineHeight = Number.parseFloat(
        getComputedStyle(element).lineHeight,
      );
      const overflows = element.scrollHeight > lineHeight + 1;
      setCanExpand(overflows);
      if (!overflows) setExpanded(false);
    };
    setExpanded(false);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    void document.fonts.ready.then(measure);
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      active = false;
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [text, lang]);

  return (
    <div className="artist-description" data-expanded={expanded}>
      <p
        ref={paragraph}
        id={id}
        className="storefront-hero-body artist-description-text"
        data-artist-description
        lang={lang}
      >
        {text}
      </p>
      {canExpand && (
        <button
          type="button"
          className="artist-description-toggle"
          data-artist-description-toggle
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? collapseLabel : expandLabel}
        </button>
      )}
    </div>
  );
}
