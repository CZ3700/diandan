"use client";
/* Session-bound private photos must bypass the public image optimizer, which neither
   forwards the order cookie nor may cache per-order bytes. */
/* eslint-disable @next/next/no-img-element */

import type { OrderAccessItem, SupportedLocale } from "@fan-support/contracts";
import { Dialog } from "@fan-support/ui/interactions";
import { formatStorefrontMessage, type StorefrontCopy } from "./copy";

/**
 * Studio photos of a delivered physical gift (V2 §4-6). Bytes load only through this browser's
 * order session via the same-origin proxy; the page never receives a storage or signed URL.
 */
export function OrderDeliveryPhotos({
  item,
  publicOrderId,
  locale,
  copy,
}: Readonly<{
  item: OrderAccessItem;
  publicOrderId: string;
  locale: SupportedLocale;
  copy: StorefrontCopy;
}>) {
  const proofs = item.deliveryProofs;
  if (proofs.length === 0) return null;
  const base = `/api/storefront/orders/${encodeURIComponent(publicOrderId)}/delivery-proofs`;
  const heading = `order-proofs-${item.position}`;
  return (
    <section
      className="order-proofs"
      data-order-proofs={item.position}
      aria-labelledby={heading}
    >
      <h4 id={heading}>{copy.orderDeliveryPhotos}</h4>
      <p className="order-proofs-help">{copy.orderDeliveryPhotosHelp}</p>
      <ul className="order-proof-list">
        {proofs.map((proof, index) => {
          const values = { position: index + 1, count: proofs.length };
          const alt = formatStorefrontMessage(
            copy,
            "orderDeliveryPhotoAlt",
            locale,
            values,
          );
          return (
            <li key={proof.proofId} data-order-proof={proof.proofId}>
              <Dialog
                triggerLabel={
                  <img
                    className="order-proof-thumbnail"
                    src={`${base}/${proof.proofId}/thumbnail`}
                    width={proof.thumbnailWidth}
                    height={proof.thumbnailHeight}
                    alt={formatStorefrontMessage(
                      copy,
                      "orderDeliveryPhotoOpen",
                      locale,
                      values,
                    )}
                    loading="lazy"
                    decoding="async"
                    // WeChat injects an inline style on <img> before hydration.
                    suppressHydrationWarning
                  />
                }
                title={alt}
                description={copy.orderDeliveryPhotosHelp}
                closeLabel={copy.orderDeliveryPhotoClose}
              >
                <img
                  className="order-proof-display"
                  src={`${base}/${proof.proofId}/display`}
                  width={proof.width}
                  height={proof.height}
                  alt={alt}
                  decoding="async"
                  suppressHydrationWarning
                />
              </Dialog>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
