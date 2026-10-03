import { expect, it, vi } from "vitest";
import type {
  ManagementCenterIntent,
  ManagementCenterOperation,
} from "@fan-support/contracts";
import { createManagementSubmission } from "./submission";
import type { ManagementApi } from "./api";

const id = "10000000-0000-4000-8000-000000000001";
const intent: ManagementCenterIntent = {
  kind: "SAVE_ARTIST",
  sourceLocale: "zh-CN",
  id: null,
  expectedVersion: 0,
  name: "测试艺人",
  description: "介绍",
  image: null,
};
const operation: ManagementCenterOperation = {
  operationId: id,
  version: 1,
  kind: "SAVE_ARTIST",
  sourceLocale: "zh-CN",
  status: "PROCESSING",
  targetId: null,
  updatedAt: "2026-09-08T00:00:00Z",
  result: null,
  failure: null,
};
function harness() {
  const prepare = vi.fn<(command: unknown) => Promise<unknown>>(async () => ({
    schemaVersion: 1,
    outcome: "SUCCESS",
    kind: "UPLOAD_GRANT",
    uploadId: id,
    replayed: false,
    grant: {
      url: "https://storage.example.invalid/upload",
      method: "PUT",
      headers: { "content-type": "image/png" },
      expiresAt: "2099-01-01T00:00:00Z",
    },
  }));
  const submit = vi.fn(async () => operation);
  const transport = vi.fn<typeof fetch>(
    async () => new Response(null, { status: 200 }),
  );
  const api = { prepare, submit } as unknown as ManagementApi;
  return {
    prepare,
    submit,
    transport,
    attempt: createManagementSubmission(api, transport as typeof fetch),
  };
}
it("uploads actual file bytes with an omitted-cookie PUT then submits only the upload reference", async () => {
  const h = harness(),
    phases: string[] = [];
  const file = new File([new Uint8Array([1, 2, 3])], "artist.png", {
    type: "image/png",
  });
  await h.attempt.submit(intent, file, (phase) => phases.push(phase));
  expect(h.prepare.mock.calls[0]?.[0]).toMatchObject({
    byteSize: 3,
    mimeType: "image/png",
    rightsConfirmed: true,
  });
  expect(h.transport.mock.calls[0]?.[1]).toMatchObject({
    method: "PUT",
    credentials: "omit",
    redirect: "error",
  });
  expect(h.submit).toHaveBeenCalledWith({ ...intent, image: { uploadId: id } });
  expect(phases).toEqual(["UPLOADING", "SUBMITTING"]);
});
it("retains a verified PUT checkpoint after a lost submit response and coalesces double clicks", async () => {
  const h = harness();
  h.submit.mockRejectedValueOnce(new Error("NETWORK_ERROR"));
  const file = new File(["bytes"], "artist.png", { type: "image/png" });
  await expect(h.attempt.submit(intent, file, () => {})).rejects.toThrow(
    "NETWORK_ERROR",
  );
  await Promise.all([
    h.attempt.submit(intent, file, () => {}),
    h.attempt.submit(intent, file, () => {}),
  ]);
  expect(h.prepare).toHaveBeenCalledTimes(1);
  expect(h.transport).toHaveBeenCalledTimes(1);
  expect(h.submit).toHaveBeenCalledTimes(2);
});
it("does not submit after a rejected PUT, but permits canonical inspection of a conditional replay", async () => {
  const h = harness(),
    file = new File(["bytes"], "artist.png", { type: "image/png" });
  h.transport.mockResolvedValueOnce(new Response(null, { status: 500 }));
  await expect(h.attempt.submit(intent, file, () => {})).rejects.toThrow(
    "UPLOAD_FAILED",
  );
  expect(h.submit).not.toHaveBeenCalled();
  h.transport.mockResolvedValueOnce(new Response(null, { status: 412 }));
  await h.attempt.submit(intent, file, () => {});
  expect(h.submit).toHaveBeenCalledTimes(1);
});
it("keeps the chosen focal point when replacing the local upload with its server reference", async () => {
  const h = harness();
  const file = new File(["bytes"], "artist.png", { type: "image/png" });
  const focused = { ...intent, image: { focalPoint: { x: 0.12345, y: 0.9 } } };
  await h.attempt.submit(
    focused as unknown as ManagementCenterIntent,
    file,
    () => {},
  );
  expect(h.submit).toHaveBeenCalledWith({
    ...intent,
    image: { uploadId: id, focalPoint: { x: 0.12345, y: 0.9 } },
  });
});
