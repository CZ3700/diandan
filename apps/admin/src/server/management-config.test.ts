import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getManagementStorefrontOrigin } from "./management-config";

test("the storefront link uses an explicit origin without credentials or paths", () => {
  expect(getManagementStorefrontOrigin({})).toBeUndefined();
  expect(
    getManagementStorefrontOrigin({
      FAN_SUPPORT_STOREFRONT_ORIGIN: "https://shop.example.test",
    }),
  ).toBe("https://shop.example.test");
  expect(
    getManagementStorefrontOrigin({
      FAN_SUPPORT_ADMIN_MODE: "TEST",
      FAN_SUPPORT_STOREFRONT_ORIGIN: "http://localhost:3011",
    }),
  ).toBe("http://localhost:3011");
  for (const origin of [
    "javascript:alert(1)",
    "https://user:password@example.test",
    "https://shop.example.test/admin",
    "https://shop.example.test?token=secret",
    "http://remote.example.test",
    "http://localhost:3011",
  ]) {
    expect(
      getManagementStorefrontOrigin({ FAN_SUPPORT_STOREFRONT_ORIGIN: origin }),
    ).toBeUndefined();
  }
});
