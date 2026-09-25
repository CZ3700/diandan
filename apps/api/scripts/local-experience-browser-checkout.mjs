import { expect } from "@playwright/test";

/** Wait for a real client interaction before entering any private form values. */
export async function waitForLocalGiftForm(page) {
  const choices = page.locator("[data-cart-personalization] input[type=radio]");
  await expect(choices).toHaveCount(2);
  await expect(async () => {
    // SSR already contains the form. A native submit before hydration would
    // reload it; this reversible conditional field proves the handlers work.
    await choices.nth(0).click();
    await choices.nth(1).click();
    await expect(page.locator("[data-cart-name]")).toBeVisible({
      timeout: 1000,
    });
  }).toPass({ timeout: 30000, intervals: [100, 250, 500] });
  await choices.nth(0).click();
  await expect(page.locator("[data-cart-name]")).toHaveCount(0);
}
