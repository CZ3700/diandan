import { useState } from "react";
import {
  DELIVERY_PROOF_PROFILE,
  type AdminOrdersLine,
  type SupportedLocale,
} from "@fan-support/contracts";
import { Button } from "@fan-support/ui";
import type { OrdersApi, OrdersDetail, ProofDownload } from "./api";
import { ordersCopy } from "./copy";
import type { MutationRunner } from "./detail-view";
import { PhotoView } from "../management-center/photo-view";

type Props = Readonly<{
  line: AdminOrdersLine;
  detail: OrdersDetail;
  api: OrdersApi;
  locale: SupportedLocale;
  busy: boolean;
  /** Delivery staff and managers only: a photo can show the fan's card. */
  canView: boolean;
  onMutation: MutationRunner;
}>;
const reasons = [
  ["PROOF_PRIVACY_ISSUE", "reasonProofPrivacy"],
  ["PROOF_WRONG_ORDER", "reasonProofWrongOrder"],
  ["PROOF_QUALITY", "reasonProofQuality"],
] as const;

/** Private photos load only on request through short-lived grants; managers can withdraw one. */
export function DeliveryProofs({
  line,
  detail,
  api,
  locale,
  busy,
  canView,
  onMutation,
}: Props) {
  const copy = ordersCopy(locale);
  const format = new Intl.NumberFormat(locale);
  const [images, setImages] = useState<Record<string, ProofDownload> | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [reason, setReason] = useState<(typeof reasons)[number][0]>(
    "PROOF_PRIVACY_ISSUE",
  );
  const [confirmed, setConfirmed] = useState(false);
  const canWithdraw = line.proofActions.includes("WITHDRAW");
  const id = `proofs-${line.itemId}`;
  const show = async () => {
    setLoading(true);
    setFailed(false);
    try {
      const loaded = await Promise.all(
        line.proofs.map(
          async (proof) =>
            [
              proof.proofId,
              await api.viewProof({
                orderId: detail.orderId,
                proofId: proof.proofId,
                rendition: "thumbnail",
              }),
            ] as const,
        ),
      );
      setImages(Object.fromEntries(loaded));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };
  return (
    <section
      className="mo-proofs"
      data-order-proofs={line.fulfillmentId}
      aria-labelledby={id}
    >
      <h3 id={id}>
        {copy.proofs} · {format.format(line.proofs.length)}/
        {format.format(DELIVERY_PROOF_PROFILE.maxActiveProofsPerLine)}
      </h3>
      {canView ? (
        images ? (
          <Button
            type="button"
            variant="secondary"
            data-proofs-hide
            onClick={() => {
              setImages(null);
              setWithdrawing(null);
            }}
          >
            {copy.hideProofs}
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            data-proofs-view
            disabled={busy || loading}
            onClick={() => void show()}
          >
            {loading ? copy.waiting : copy.viewProofs}
          </Button>
        )
      ) : null}
      {failed ? (
        <p className="mc-error" role="alert">
          {copy.failure}
        </p>
      ) : null}
      {images ? (
        <ul className="mo-proof-grid">
          {line.proofs.map((proof, index) => {
            const image = images[proof.proofId];
            return (
              <li key={proof.proofId} data-proof={proof.proofId}>
                {image ? (
                  <PhotoView
                    src={image.download.url}
                    alt={`${copy.proofAlt} ${format.format(index + 1)}`}
                    unavailable={copy.unavailable}
                    referrerPolicy="no-referrer"
                  />
                ) : null}
                {canWithdraw && withdrawing === proof.proofId ? (
                  <div className="mo-proof-withdraw">
                    <label className="mc-field">
                      <span>{copy.reason}</span>
                      <select
                        data-proof-withdraw-reason
                        value={reason}
                        disabled={busy}
                        onChange={(event) =>
                          setReason(
                            event.currentTarget
                              .value as (typeof reasons)[number][0],
                          )
                        }
                      >
                        {reasons.map(([value, label]) => (
                          <option key={value} value={value}>
                            {copy[label]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="mo-check">
                      <input
                        type="checkbox"
                        data-proof-withdraw-confirm
                        checked={confirmed}
                        disabled={busy}
                        onChange={(event) =>
                          setConfirmed(event.currentTarget.checked)
                        }
                      />
                      <span>{copy.confirmWithdraw}</span>
                    </label>
                    <div className="mo-actions">
                      <Button
                        type="button"
                        variant="secondary"
                        data-proof-withdraw-submit
                        disabled={busy || !confirmed}
                        onClick={() =>
                          void onMutation(() =>
                            api.withdrawProof({
                              orderId: detail.orderId,
                              expectedOrderVersion: detail.version,
                              fulfillmentId: line.fulfillmentId,
                              expectedFulfillmentVersion:
                                line.fulfillmentVersion,
                              proofId: proof.proofId,
                              reasonCode: reason,
                              confirmed: true,
                            }),
                          )
                        }
                      >
                        {copy.withdrawProof}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => setWithdrawing(null)}
                      >
                        {copy.cancel}
                      </Button>
                    </div>
                  </div>
                ) : canWithdraw ? (
                  <Button
                    type="button"
                    variant="secondary"
                    data-proof-withdraw={proof.proofId}
                    disabled={busy}
                    onClick={() => {
                      setWithdrawing(proof.proofId);
                      setConfirmed(false);
                    }}
                  >
                    {copy.withdrawProof}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
