import type { StorefrontNavigation } from "@fan-support/contracts";
export const navigationFixture = (): StorefrontNavigation => ({
  schemaVersion: 1,
  header: ["HOME", "ARTISTS", "GIFTS"],
  footer: [
    { id: "DESCRIPTION", visible: true },
    { id: "REGION", visible: true },
    { id: "ARTISTS", visible: true },
    { id: "GIFTS", visible: false },
    { id: "POLICIES", visible: true },
  ],
});
