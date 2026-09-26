import { expect, test, vi } from "vitest";
import { createDeliveryProofAttempt } from "./proof-upload";
import type { OrdersApi } from "./api";

const orderId = "10000000-0000-4000-8000-000000000001",
  fulfillmentId = "10000000-0000-4000-8000-000000000002",
  uploadId = "10000000-0000-4000-8000-000000000003";
const target = {
  orderId,
  expectedOrderVersion: 2,
  fulfillmentId,
  expectedFulfillmentVersion: 3,
};
const photo = () =>
  new File([new Uint8Array([255, 216, 255, 1, 2, 3])], "gift.jpg", {
    type: "image/jpeg",
  });
function fakeApi() {
  return {
    beginProofUpload: vi.fn(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "PROOF_UPLOAD_GRANT",
      orderId,
      uploadId,
      replayed: false,
      grant: {
        method: "PUT",
        url: "https://storage.example.invalid/private?X-Amz-Signature=fixture",
        headers: { "if-none-match": "*" },
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    })),
    completeProofUpload: vi.fn(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "PROOF_UPLOAD",
      orderId,
      uploadId,
      width: 1600,
      height: 1200,
    })),
    attachProofs: vi.fn(async () => ({
      schemaVersion: 1,
      outcome: "SUCCESS",
      kind: "MUTATION",
      orderId,
      resultId: uploadId,
      replayed: false,
    })),
  };
}

test("a photo is reserved by its own bytes, PUT privately without credentials, then verified", async () => {
  const api = fakeApi();
  const transport = vi.fn<typeof fetch>(
    async () => new Response(null, { status: 200 }),
  );
  const attempt = createDeliveryProofAttempt(transport);
  expect(
    await attempt.upload(api as unknown as OrdersApi, target, photo()),
  ).toBe(uploadId);
  expect(api.beginProofUpload).toHaveBeenCalledWith({
    ...target,
    reasonCode: "DELIVERY_PROOF_UPLOAD",
    checksumSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    byteSize: 6,
    mimeType: "image/jpeg",
  });
  const [url, init] = transport.mock.calls[0]!;
  expect(String(url)).toContain("storage.example.invalid");
  expect(init).toMatchObject({
    method: "PUT",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  expect(api.completeProofUpload).toHaveBeenCalledWith({
    orderId,
    uploadId,
  });
});

test("a retry resumes after the last finished step and a lost PUT response is accepted", async () => {
  const api = fakeApi();
  api.completeProofUpload.mockRejectedValueOnce(new Error("lost response"));
  const transport = vi.fn<typeof fetch>(
    async () => new Response(null, { status: 412 }),
  );
  const attempt = createDeliveryProofAttempt(transport);
  const file = photo();
  await expect(
    attempt.upload(api as unknown as OrdersApi, target, file),
  ).rejects.toThrow("lost response");
  expect(await attempt.upload(api as unknown as OrdersApi, target, file)).toBe(
    uploadId,
  );
  expect(api.beginProofUpload).toHaveBeenCalledTimes(1);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(api.completeProofUpload).toHaveBeenCalledTimes(2);
});

test("a rejected upload stops before verification", async () => {
  const api = fakeApi();
  const attempt = createDeliveryProofAttempt(
    vi.fn<typeof fetch>(async () => new Response(null, { status: 403 })),
  );
  await expect(
    attempt.upload(api as unknown as OrdersApi, target, photo()),
  ).rejects.toMatchObject({ code: "UPLOAD_FAILED" });
  expect(api.completeProofUpload).not.toHaveBeenCalled();
});

test("the same photos attach once with explicit privacy confirmation", async () => {
  const api = fakeApi();
  const attempt = createDeliveryProofAttempt(vi.fn());
  await attempt.attach(api as unknown as OrdersApi, target, [uploadId]);
  await attempt.attach(api as unknown as OrdersApi, target, [uploadId]);
  expect(api.attachProofs).toHaveBeenCalledTimes(1);
  expect(api.attachProofs).toHaveBeenCalledWith({
    ...target,
    reasonCode: "DELIVERY_PROOF_CONFIRMED",
    uploadIds: [uploadId],
    privacyConfirmed: true,
  });
});
