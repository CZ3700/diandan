/** The browser observer retains only booleans and fixed categories; raw fragments are never reported. */
export async function observeOrderStorefrontPage(
  page,
  { origin, canaries, check },
) {
  const requests = [],
    responses = [],
    fragmentEvents = [],
    pending = new Set();
  await page.exposeFunction("__reportOrderFragment", (event) => {
    fragmentEvents.push({
      stage: event.stage,
      cleared: event.cleared === true,
    });
  });
  let leaked = false,
    pageErrors = 0;
  await page.addInitScript(() => {
    const fragment = globalThis.location.hash;
    const token = new globalThis.URLSearchParams(fragment.slice(1)).get(
      "token",
    );
    const evidence = {
      initialFragment: Boolean(fragment),
      replacementCleared: false,
      exchangeAfterClear: [],
      pageShows: [],
    };
    const replace = globalThis.history.replaceState.bind(globalThis.history);
    globalThis.history.replaceState = (...args) => {
      const value = replace(...args);
      if (
        fragment &&
        !globalThis.location.hash &&
        !globalThis.location.search
      ) {
        evidence.replacementCleared = true;
        void globalThis.__reportOrderFragment({
          stage: "REPLACE",
          cleared: true,
        });
      }
      return value;
    };
    const fetcher = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (...args) => {
      const input = args[0];
      const url = new globalThis.URL(
        typeof input === "string" ? input : (input.url ?? String(input)),
        globalThis.location.href,
      );
      if (url.pathname === "/api/storefront/order-access/exchange") {
        evidence.exchangeAfterClear.push(
          !globalThis.location.hash && !globalThis.location.search,
        );
        void globalThis.__reportOrderFragment({
          stage: "EXCHANGE",
          cleared: !globalThis.location.hash && !globalThis.location.search,
        });
      }
      return fetcher(...args);
    };
    globalThis.addEventListener("pageshow", (event) =>
      evidence.pageShows.push({ persisted: event.persisted }),
    );
    Object.defineProperty(globalThis, "__orderBrowserEvidence", {
      value: () => ({
        ...evidence,
        fragmentAbsent: !globalThis.location.hash,
        privateTokenInStorage: token
          ? [
              globalThis.document.cookie,
              ...Object.values(globalThis.localStorage),
              ...Object.values(globalThis.sessionStorage),
            ].some((value) => value.includes(token))
          : false,
      }),
      configurable: true,
    });
  });
  const request = (entry) => {
    const url = new globalThis.URL(entry.url());
    leaked ||= canaries.some(
      (canary) =>
        entry.url().includes(canary) ||
        (entry.headers()["referer"] ?? "").includes(canary),
    );
    if (url.origin === origin && url.pathname.startsWith("/api/storefront/"))
      requests.push({
        method: entry.method(),
        category: url.pathname.includes("order-access")
          ? "ACCESS"
          : url.pathname.includes("/orders/")
            ? "READ"
            : "OTHER",
      });
  };
  const response = (entry) => {
    const url = new globalThis.URL(entry.url());
    if (
      url.origin !== origin ||
      !/^\/api\/storefront\/(?:order-access\/|orders\/|checkout\/sessions\/[^/]+\/order-access$)/u.test(
        url.pathname,
      )
    )
      return;
    let task;
    task = (async () => {
      const headers = await entry.allHeaders();
      let data;
      try {
        data = await entry.json();
      } catch {
        /* Deliberately discarded body or aborted navigation stays visible as null. */
      }
      if (data)
        leaked ||= canaries.some((canary) =>
          JSON.stringify(data).includes(canary),
        );
      responses.push({
        category: url.pathname.includes("/orders/")
          ? "READ"
          : url.pathname.endsWith("/exchange")
            ? "EXCHANGE"
            : url.pathname.endsWith("/revoke")
              ? "REVOKE"
              : url.pathname.endsWith("/locate")
                ? "LOCATE"
                : "BOOTSTRAP",
        status: entry.status(),
        action: data?.action ?? null,
        code: data?.outcome === "FAILURE" ? data.code : null,
        privateCache: headers["cache-control"] === "private, no-store",
        noReferrer: headers["referrer-policy"] === "no-referrer",
        noIndex: headers["x-robots-tag"]?.includes("noindex") === true,
      });
    })().finally(() => pending.delete(task));
    pending.add(task);
  };
  const error = () => {
    pageErrors++;
  };
  page.on("request", request);
  page.on("response", response);
  page.on("pageerror", error);
  return {
    async snapshot() {
      await Promise.all(pending);
      check(
        !leaked,
        "Token, email, name and private message do not leak to browser URL, referrer or public responses",
      );
      check(
        pageErrors === 0,
        "Order pages have no uncaught browser runtime errors",
      );
      return {
        requests: [...requests],
        responses: [...responses],
        fragmentEvents: [...fragmentEvents],
        pageErrors,
        leaked,
      };
    },
    dispose() {
      page.off("request", request);
      page.off("response", response);
      page.off("pageerror", error);
    },
  };
}
