import { expect, test } from "vitest";
import { previewEmbeddingOrigin } from "./preview-embedding";

test("previews may be framed only by a valid configured admin origin", () => {
  expect(
    previewEmbeddingOrigin({
      FAN_SUPPORT_ADMIN_ORIGIN: "https://admin.example.invalid",
      FAN_SUPPORT_DEPLOYMENT_ENV: "production",
    }),
  ).toBe("https://admin.example.invalid");
  expect(previewEmbeddingOrigin({})).toBeNull();
  // Invalid configuration cannot broaden embedding.
  expect(
    previewEmbeddingOrigin({
      FAN_SUPPORT_ADMIN_ORIGIN: "http://admin.example.invalid",
      FAN_SUPPORT_DEPLOYMENT_ENV: "production",
    }),
  ).toBeNull();
});
