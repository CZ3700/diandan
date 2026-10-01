"use client";
import { useEffect, useRef, useState } from "react";
import { getImageProps } from "next/image";
import type { StorefrontBrandView } from "@fan-support/contracts";
import { useStorefrontBrand } from "./branding-provider";

type Logo = NonNullable<StorefrontBrandView["lightLogo"]>;

function BrandText({ name }: Readonly<{ name: string }>) {
  return (
    <span className="storefront-brand-text">
      {name}
      <span className="storefront-brand-dot">.</span>
    </span>
  );
}

function BrandImage({ logo, name }: Readonly<{ logo: Logo; name: string }>) {
  const image = useRef<HTMLImageElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (image.current?.complete && image.current.naturalWidth === 0)
      setFailed(true);
  }, []);
  let source: { src: string; srcSet?: string; sizes?: string } | null = null;
  try {
    const { props } = getImageProps({
      src: logo.url,
      alt: "",
      width: logo.width,
      height: logo.height,
      quality: 75,
      sizes: "(max-width: 48rem) 144px, 192px",
    });
    // The optimizer enforces the configured media origin and processed-path allowlist.
    // Never fall back to fetching an unvalidated remote URL directly in the browser.
    if (props.src.startsWith("/_next/image?"))
      source = {
        src: props.src,
        ...(props.srcSet ? { srcSet: props.srcSet } : {}),
        ...(props.sizes ? { sizes: props.sizes } : {}),
      };
  } catch {
    /* A disallowed source keeps the text brand visible. */
  }
  if (failed || !source) return <BrandText name={name} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- getImageProps already routes this source through the allowlisted Next optimizer.
    <img
      ref={image}
      className="storefront-brand-logo"
      {...source}
      alt=""
      width={logo.width}
      height={logo.height}
      decoding="async"
      loading="eager"
      onError={() => setFailed(true)}
    />
  );
}

/** Both theme slots are SSR-visible; CSS chooses the current palette without a flash. */
export function SiteBrand({ name }: Readonly<{ name: string }>) {
  const { brand, source, version } = useStorefrontBrand();
  return (
    <span
      className="storefront-brand"
      role="img"
      aria-label={name}
      data-brand-source={source}
      data-brand-version={version}
    >
      {(
        [
          ["LIGHT", brand.lightLogo],
          ["DARK", brand.darkLogo],
        ] as const
      ).map(([scheme, logo]) => (
        <span
          key={scheme}
          className="storefront-brand-slot"
          data-brand-scheme={scheme}
          data-brand-image={logo ? "true" : undefined}
          aria-hidden="true"
        >
          {logo ? (
            <BrandImage
              key={`${logo.assetId}:${logo.url}`}
              logo={logo}
              name={name}
            />
          ) : (
            <BrandText name={name} />
          )}
        </span>
      ))}
    </span>
  );
}
