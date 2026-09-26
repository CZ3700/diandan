import { useEffect, useRef, useState } from "react";
import {
  DELIVERY_PROOF_PROFILE,
  type AdminOrdersLine,
  type SupportedLocale,
} from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import { imageSelectionIssue } from "../management-center/inputs";
import { PhotoView } from "../management-center/photo-view";
import type { OrdersApi, OrdersDetail } from "./api";
import { ordersCopy } from "./copy";
import type { MutationRunner } from "./detail-view";
import {
  createDeliveryProofAttempt,
  type DeliveryProofAttempt,
  type ProofTarget,
} from "./proof-upload";

type Props = Readonly<{
  /** DELIVER confirms delivery with optional photos; ATTACH only adds photos to a line. */
  mode: "DELIVER" | "ATTACH";
  line: AdminOrdersLine;
  detail: OrdersDetail;
  api: OrdersApi;
  locale: SupportedLocale;
  busy: boolean;
  onMutation: MutationRunner;
  onClose: () => void;
  createAttempt?: () => DeliveryProofAttempt;
}>;

/** Photos upload privately, attach, and only then is the line delivered, so the buyer sees both together. */
export function DeliveryProofPanel({
  mode,
  line,
  detail,
  api,
  locale,
  busy,
  onMutation,
  onClose,
  createAttempt = () => createDeliveryProofAttempt(),
}: Props) {
  const copy = ordersCopy(locale);
  const room =
    DELIVERY_PROOF_PROFILE.maxActiveProofsPerLine - line.proofs.length;
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [issue, setIssue] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const attempt = useRef<DeliveryProofAttempt | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = `proof-${line.itemId}`;
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);
  const target: ProofTarget = {
    orderId: detail.orderId,
    expectedOrderVersion: detail.version,
    fulfillmentId: line.fulfillmentId,
    expectedFulfillmentVersion: line.fulfillmentVersion,
  };
  const ready =
    files.length === 0 ? mode === "DELIVER" : confirmed && files.length <= room;
  const choose = (chosen: File[]) => {
    if (chosen.some((file) => imageSelectionIssue(file) !== null))
      return setIssue(copy.proofFormat);
    const next = [...files, ...chosen];
    if (next.length > room) return setIssue(copy.proofLimit);
    setIssue(null);
    setConfirmed(false);
    setFiles(next);
  };
  const submit = async () => {
    const current = (attempt.current ??= createAttempt());
    const done = await onMutation(async () => {
      try {
        const uploadIds: string[] = [];
        if (files.length > 0) setProgress(copy.proofUploading);
        for (const file of files)
          uploadIds.push(await current.upload(api, target, file));
        if (uploadIds.length > 0) {
          setProgress(copy.proofSaving);
          await current.attach(api, target, uploadIds);
        }
        if (mode === "DELIVER") {
          setProgress(copy.proofDelivering);
          await api.deliver({
            ...target,
            reasonCode: "ORDER_DELIVERY_CONFIRMED",
          });
        }
      } finally {
        setProgress(null);
      }
    });
    if (done) onClose();
  };
  return (
    <section
      className="mo-proof-panel"
      data-proof-panel={mode}
      aria-labelledby={id}
    >
      <h3 id={id} ref={heading} tabIndex={-1}>
        {mode === "DELIVER" ? copy.deliverTitle : copy.addProofs}
      </h3>
      <p className="mc-hint">{copy.proofIntro}</p>
      <p className="mo-proof-privacy" data-proof-privacy>
        {copy.proofPrivacy}
      </p>
      {mode === "DELIVER" ? (
        <p className="mc-hint">{copy.proofOptional}</p>
      ) : null}
      <label className="mc-field">
        <span>{copy.proofChoose}</span>
        <input
          type="file"
          data-proof-files
          multiple
          accept="image/jpeg,image/png,image/webp"
          disabled={busy || files.length >= room}
          aria-invalid={issue !== null}
          onChange={(event) => {
            const chosen = [...(event.currentTarget.files ?? [])];
            event.currentTarget.value = "";
            if (chosen.length > 0) choose(chosen);
          }}
        />
      </label>
      {issue ? (
        <p className="mc-error" role="alert">
          {issue}
        </p>
      ) : null}
      {files.length > 0 ? (
        <ul className="mo-proof-grid" data-proof-previews>
          {files.map((file, index) => (
            <li key={`${file.name}-${file.size}-${file.lastModified}`}>
              {previews[index] ? (
                <PhotoView
                  src={previews[index]}
                  alt={`${copy.proofAlt} ${new Intl.NumberFormat(locale).format(index + 1)}`}
                  unavailable={copy.unavailable}
                />
              ) : null}
              <Button
                type="button"
                variant="secondary"
                data-proof-remove
                disabled={busy}
                onClick={() => {
                  setConfirmed(false);
                  setFiles(files.filter((_, position) => position !== index));
                }}
              >
                {copy.proofRemove}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {files.length > 0 ? (
        <label className="mo-check">
          <input
            type="checkbox"
            data-proof-privacy-confirm
            checked={confirmed}
            disabled={busy}
            onChange={(event) => setConfirmed(event.currentTarget.checked)}
          />
          <span>{copy.proofConfirmPrivacy}</span>
        </label>
      ) : null}
      {progress ? (
        <p className="mc-hint" role="status">
          {progress}
        </p>
      ) : null}
      <div className="mo-actions">
        <Button
          type="button"
          data-proof-submit={mode}
          disabled={busy || !ready}
          onClick={() => void submit()}
        >
          {mode === "DELIVER" ? copy.confirmDelivery : copy.saveProofs}
        </Button>
        <Button
          type="button"
          variant="secondary"
          data-proof-cancel
          disabled={busy}
          onClick={onClose}
        >
          {copy.cancel}
        </Button>
      </div>
    </section>
  );
}
