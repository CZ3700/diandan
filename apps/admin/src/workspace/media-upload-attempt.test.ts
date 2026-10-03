import { expect, it } from "vitest";
import { createAdminClient } from "./client";
import { createMediaUploadAttempt } from "./media-upload-attempt";
import type { AdminClient } from "./client";
const id = "10000000-0000-4000-8000-000000000001";
it("transfers a logo ticket without completing the ordinary media publication workflow", async () => {
  const operations: string[] = [];
  let puts = 0;
  const client = {
    call: async (operation: string) => {
      operations.push(operation);
      return {
        kind: "UPLOAD_GRANT",
        uploadId: id,
        grant: {
          method: "PUT",
          url: "https://storage.example.invalid/upload",
          headers: {},
          expiresAt: "2099-01-01T00:00:00Z",
        },
      };
    },
  } as unknown as AdminClient;
  const attempt = createMediaUploadAttempt(async (_url, init) => {
    puts++;
    expect(init?.credentials).toBe("omit");
    expect(init?.redirect).toBe("error");
    return new Response(null, { status: 412 });
  });
  expect(attempt.transfer).toBeTypeOf("function");
  const source = {
    checksumSha256: "a".repeat(64),
    byteSize: 1,
    mimeType: "image/png",
    rightsReference: "STOREFRONT_BRAND",
  };
  expect(await attempt.transfer(client, source, new ArrayBuffer(1))).toEqual({
    uploadId: id,
  });
  expect(await attempt.transfer(client, source, new ArrayBuffer(1))).toEqual({
    uploadId: id,
  });
  expect(operations).toEqual(["media-upload-begin"]);
  expect(puts).toBe(1);
});
it("does not trust an existing conditional PUT object without canonical COMPLETE verification", async () => {
  const operations: string[] = [];
  const client = {
    call: async (operation: string) => {
      operations.push(operation);
      if (operation === "media-upload-begin")
        return {
          kind: "UPLOAD_GRANT",
          uploadId: id,
          grant: {
            method: "PUT",
            url: "https://storage.example.invalid/upload",
            headers: {},
            expiresAt: "2099-01-01T00:00:00Z",
          },
        };
      throw new Error("SOURCE_CHECK_FAILED");
    },
  } as unknown as AdminClient;
  const attempt = createMediaUploadAttempt(
    (async () => new Response(null, { status: 412 })) as typeof fetch,
  );
  await expect(
    attempt.upload(
      client,
      {
        checksumSha256: "a".repeat(64),
        byteSize: 1,
        mimeType: "image/png",
        rightsReference: "TEST_RIGHTS",
      },
      new ArrayBuffer(1),
    ),
  ).rejects.toThrow("SOURCE_CHECK_FAILED");
  expect(operations).toEqual(["media-upload-begin", "media-upload-complete"]);
});
it("resumes a successful PUT after an uncertain COMPLETE without reserving or uploading again", async () => {
  const operations: string[] = [];
  const completeHeaders: (HeadersInit | undefined)[] = [];
  let puts = 0;
  const client = createAdminClient(
    () => "csrf",
    () => {},
    (async (url: RequestInfo | URL, init: RequestInit = {}) => {
      const operation = String(url).split("/").pop()!;
      operations.push(operation);
      if (operation === "media-upload-begin")
        return Response.json({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "UPLOAD_GRANT",
          uploadId: id,
          replayed: false,
          grant: {
            method: "PUT",
            url: "https://storage.example.invalid/upload",
            headers: { "content-type": "image/png" },
            expiresAt: "2099-01-01T00:00:00Z",
          },
        });
      if (operation === "media-upload-complete") {
        completeHeaders.push(init.headers);
        if (completeHeaders.length === 1) throw new Error("lost response");
        return Response.json({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "MUTATION",
          resultId: id,
          replayed: true,
        });
      }
      if (operation === "media-upload-read")
        return Response.json({
          schemaVersion: 1,
          outcome: "SUCCESS",
          kind: "UPLOAD",
          upload: {
            schemaVersion: 1,
            uploadId: id,
            version: 2,
            status: "REGISTERED",
            assetId: id,
            expiresAt: "2099-01-01T00:00:00Z",
          },
        });
      return Response.json({
        schemaVersion: 1,
        outcome: "FAILURE",
        code: "CONTENT_UNAVAILABLE",
      });
    }) as typeof fetch,
  );
  const attempt = createMediaUploadAttempt((async () => {
    puts++;
    return new Response(null, { status: 200 });
  }) as typeof fetch);
  const source = {
    checksumSha256: "a".repeat(64),
    byteSize: 1,
    mimeType: "image/png",
    rightsReference: "TEST_RIGHTS",
  };
  const bytes = new ArrayBuffer(1);
  await expect(attempt.upload(client, source, bytes)).rejects.toThrow(
    "NETWORK_ERROR",
  );
  // Owner lookup deliberately fails after successful registration; another retry must only repeat that read.
  await expect(attempt.upload(client, source, bytes)).rejects.toThrow(
    "CONTENT_UNAVAILABLE",
  );
  await expect(attempt.upload(client, source, bytes)).rejects.toThrow(
    "CONTENT_UNAVAILABLE",
  );
  expect(
    operations.filter((operation) => operation === "media-upload-begin"),
  ).toHaveLength(1);
  expect(puts).toBe(1);
  expect(completeHeaders).toHaveLength(2);
  expect(completeHeaders[0]).toEqual(completeHeaders[1]);
  expect(
    operations.filter((operation) => operation === "media-upload-read"),
  ).toHaveLength(1);
});
