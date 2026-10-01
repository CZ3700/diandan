"use client";
/* The saved certificate preview is a local blob; it must bypass the public image optimizer. */
/* eslint-disable @next/next/no-img-element */

import { getImageProps } from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import type {
  OrderAccessItem,
  OrderAccessSupportCertificate,
  SupportedLocale,
} from "@fan-support/contracts";
import { Button, Field } from "@fan-support/ui";
import { formatStorefrontMessage, type StorefrontCopy } from "./copy";
import {
  CERTIFICATE_NAME_MAX,
  CERTIFICATE_IMAGE_SIZE,
  certificateDeliveredDate,
  certificateFileName,
  certificateGiftLine,
  certificateSignatureName,
  certificateText,
  readCertificateTheme,
  renderSupportCertificate,
  type CertificateSignature,
} from "./support-certificate-image";

type Mode = CertificateSignature["mode"];
type Status = "idle" | "saving" | "ready" | "failed";

/** Same-origin optimizer URL, so the canvas can read the photo without loosening CSP. */
function sameOriginPhoto(url: string, width: number, height: number) {
  try {
    const { props } = getImageProps({
      src: url,
      alt: "",
      width,
      height,
      quality: 75,
    });
    return props.src.startsWith("/") ? props.src : null;
  } catch {
    return null;
  }
}

/**
 * ADR-019 supplement (L3-09): a delivered virtual line's digital support certificate. Shows
 * artist, gift, quantity, delivery date and order number only; the fan may add a signature that
 * is used just to draw the image on this device.
 */
export function OrderSupportCertificate({
  item,
  certificate,
  publicOrderNo,
  locale,
  copy,
}: Readonly<{
  item: OrderAccessItem;
  certificate: OrderAccessSupportCertificate;
  publicOrderNo: string;
  locale: SupportedLocale;
  copy: StorefrontCopy;
}>) {
  const id = useId();
  const root = useRef<HTMLElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("NONE");
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);

  const replacePreview = (next: string | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = next;
    setPreview(next);
  };
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );
  // A changed signature makes the shown image stale.
  const choose = (next: Mode) => {
    setMode(next);
    setNameError(false);
    if (status !== "saving") setStatus("idle");
    replacePreview(null);
  };

  const save = async () => {
    let signature: CertificateSignature = { mode: "NONE" };
    if (mode === "ANONYMOUS") signature = { mode };
    if (mode === "NAME") {
      const valid = certificateSignatureName(name);
      if (valid === null) {
        setNameError(true);
        nameInput.current?.focus();
        return;
      }
      signature = { mode, name: valid };
    }
    const element = root.current;
    if (!element) return;
    setStatus("saving");
    try {
      const blob = await renderSupportCertificate(
        certificateText(
          item,
          certificate,
          publicOrderNo,
          locale,
          copy,
          signature,
        ),
        readCertificateTheme(element),
        locale,
        {
          artist: sameOriginPhoto(item.idol.portrait.url, 414, 518),
          gift: sameOriginPhoto(item.gift.image.url, 224, 224),
        },
      );
      const url = URL.createObjectURL(blob);
      replacePreview(url);
      const link = document.createElement("a");
      link.href = url;
      link.download = certificateFileName(publicOrderNo, item.position);
      link.rel = "noopener";
      document.body.append(link);
      link.click();
      link.remove();
      setStatus("ready");
    } catch {
      setStatus("failed");
    }
  };

  const titleId = `${id}-title`;
  const revoked = certificate.revoked;
  return (
    <section
      ref={root}
      className="order-certificate"
      aria-labelledby={titleId}
      data-support-certificate
      data-certificate-state={revoked ? "REVOKED" : "AVAILABLE"}
    >
      <div className="order-certificate-card">
        <h4 id={titleId} className="order-certificate-title">
          {copy.orderCertificateTitle}
        </h4>
        <p
          className="order-certificate-artist"
          lang={item.idol.locale.resolvedLocale}
        >
          {item.idol.displayName}
        </p>
        <p
          className="order-certificate-gift"
          lang={item.gift.locale.resolvedLocale}
          data-certificate-quantity={item.quantity}
        >
          {certificateGiftLine(item, locale, copy)}
        </p>
        <p className="order-certificate-meta">
          <time dateTime={certificate.deliveredAt}>
            {formatStorefrontMessage(
              copy,
              "orderCertificateDelivered",
              locale,
              {
                date: certificateDeliveredDate(certificate, locale),
              },
            )}
          </time>
          <span>
            {formatStorefrontMessage(copy, "orderCertificateOrder", locale, {
              number: publicOrderNo,
            })}
          </span>
        </p>
      </div>
      {revoked ? (
        <p className="order-certificate-revoked" data-certificate-revoked>
          {copy.orderCertificateRevoked}
        </p>
      ) : (
        <div className="order-certificate-save">
          <p className="order-certificate-help">
            {formatStorefrontMessage(copy, "orderCertificateHelp", locale, {
              artist: item.idol.displayName,
            })}
          </p>
          <fieldset className="order-certificate-signature">
            <legend>{copy.orderCertificateSignature}</legend>
            {(
              [
                ["NONE", copy.orderCertificateSignatureNone],
                ["ANONYMOUS", copy.orderCertificateSignatureAnonymous],
                ["NAME", copy.orderCertificateSignatureName],
              ] as const
            ).map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name={`${id}-signature`}
                  value={value}
                  checked={mode === value}
                  onChange={() => choose(value)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          {mode === "NAME" && (
            <Field
              ref={nameInput}
              id={`${id}-name`}
              label={copy.orderCertificateNameLabel}
              hint={copy.orderCertificateNameHint}
              {...(nameError
                ? { error: copy.orderCertificateNameInvalid }
                : {})}
              value={name}
              maxLength={CERTIFICATE_NAME_MAX * 2}
              autoComplete="off"
              data-certificate-name
              onChange={(event) => {
                setName(event.currentTarget.value);
                setNameError(false);
                replacePreview(null);
                if (status !== "saving") setStatus("idle");
              }}
            />
          )}
          <Button
            type="button"
            variant="secondary"
            loading={status === "saving"}
            disabled={status === "saving"}
            onClick={() => void save()}
            data-certificate-save
          >
            {status === "saving"
              ? copy.orderCertificateSaving
              : copy.orderCertificateSave}
          </Button>
          <p className="order-certificate-status" role="status">
            {status === "ready"
              ? copy.orderCertificateReady
              : status === "failed"
                ? copy.orderCertificateFailed
                : ""}
          </p>
          {preview && (
            <img
              className="order-certificate-preview"
              src={preview}
              width={CERTIFICATE_IMAGE_SIZE.width}
              height={CERTIFICATE_IMAGE_SIZE.height}
              alt={formatStorefrontMessage(
                copy,
                "orderCertificateImageAlt",
                locale,
                { artist: item.idol.displayName },
              )}
              data-certificate-preview
            />
          )}
        </div>
      )}
    </section>
  );
}
