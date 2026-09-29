import {
  adminLocalAccessBrowserResponseSchema,
  type AdminLocalAccessBrowserResponse,
} from "@fan-support/contracts";

const UNAVAILABLE: AdminLocalAccessBrowserResponse = {
  schemaVersion: 1,
  outcome: "FAILURE",
  code: "ACCESS_UNAVAILABLE",
};

/** Same-origin JSON to the Admin BFF; tokens stay in HttpOnly cookies and never reach this code. */
export async function submitSignIn(
  action: "login" | "step",
  body: unknown,
  fetcher: typeof fetch = fetch,
): Promise<AdminLocalAccessBrowserResponse> {
  try {
    const response = await fetcher(`/api/admin/local-auth/${action}`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = adminLocalAccessBrowserResponseSchema.safeParse(
      await response.json(),
    );
    return parsed.success ? parsed.data : UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}
