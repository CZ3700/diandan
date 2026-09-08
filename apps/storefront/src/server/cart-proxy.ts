import "server-only";
import {
  cartRuntimeCommandSchema,
  cartRuntimeCurrentResponseSchema,
  cartEditCommandSchema,
  cartEditResponseSchema,
  cartEditorResponseSchema,
  idempotencyKeySchema,
} from "@fan-support/contracts";
import {
  resolveInternalApiRuntimeConfig,
  resolveServerRuntimeConfig,
} from "@fan-support/config/server";

const cookieName = "__Host-fan-cart";
const credential = /^[A-Za-z0-9_-]{43}$/u;
const privateHeaders = {
  "cache-control": "private, no-store",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};
function failure(status = 503, code = "TEMPORARY_UNAVAILABLE") {
  return Response.json(
    { schemaVersion: 1, outcome: "FAILURE", code },
    { status, headers: privateHeaders },
  );
}
function cartCookie(header: string | null): string | undefined {
  let result: string | undefined;
  for (const part of header?.split(";") ?? []) {
    const [name, ...values] = part.trim().split("=");
    if (name !== cookieName) continue;
    if (
      result !== undefined ||
      values.length !== 1 ||
      !credential.test(values[0]!)
    )
      throw new Error("Invalid cart cookie");
    result = `${cookieName}=${values[0]}`;
  }
  return result;
}
function safeSetCookie(header: string, clear: boolean) {
  const parts = header.split(";").map((part) => part.trim());
  const first = parts.shift()!;
  if (
    clear
      ? first !== `${cookieName}=`
      : !first.startsWith(`${cookieName}=`) ||
        !credential.test(first.slice(cookieName.length + 1))
  )
    return false;
  const attributes = new Map<string, string>();
  for (const part of parts) {
    const index = part.indexOf("=");
    const key = (index < 0 ? part : part.slice(0, index)).toLowerCase();
    const value = index < 0 ? "" : part.slice(index + 1);
    if (
      attributes.has(key) ||
      ![
        "path",
        "httponly",
        "secure",
        "samesite",
        clear ? "max-age" : "expires",
      ].includes(key)
    )
      return false;
    attributes.set(key, value);
  }
  return (
    attributes.size === 5 &&
    attributes.get("path") === "/" &&
    attributes.get("httponly") === "" &&
    attributes.get("secure") === "" &&
    attributes.get("samesite")?.toLowerCase() === "lax" &&
    (clear
      ? attributes.get("max-age") === "0"
      : Number.isFinite(Date.parse(attributes.get("expires") ?? "")))
  );
}
async function limitedText(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
) {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error("Cart body limit");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
function responseStatus(code: string): readonly number[] {
  if (code === "INVALID_COMMAND") return [400, 413];
  if (code === "INVALID_ACCESS") return [401, 403];
  if (code === "CART_NOT_FOUND" || code === "ITEM_NOT_FOUND") return [404];
  if (
    [
      "TEMPORARY_UNAVAILABLE",
      "TRANSACTION_OUTCOME_UNKNOWN",
      "CONTENT_UNAVAILABLE",
      "COMMERCE_UNAVAILABLE",
    ].includes(code)
  )
    return [503];
  return [409];
}

/** Fixed same-origin cart routes only; the sole credential stays in a host-only cookie. */
export async function proxyCartRequest(
  request: Request,
  options: {
    siteOrigin: string;
    internalApiOrigin: string;
    fetcher?: typeof fetch;
  },
): Promise<Response> {
  let mutationDispatched = false;
  const unavailable = () =>
    failure(
      503,
      mutationDispatched
        ? "TRANSACTION_OUTCOME_UNKNOWN"
        : "TEMPORARY_UNAVAILABLE",
    );
  try {
    const incoming = new URL(request.url);
    const targetOrigin = new URL(options.internalApiOrigin);
    if (
      incoming.origin !== options.siteOrigin ||
      targetOrigin.origin !== options.internalApiOrigin ||
      !["http:", "https:"].includes(targetOrigin.protocol)
    )
      return failure(403, "INVALID_ACCESS");
    const method = request.method;
    const suppliedOrigin = request.headers.get("origin");
    if (
      ((method !== "GET" || suppliedOrigin !== null) &&
        suppliedOrigin !== options.siteOrigin) ||
      (request.headers.has("sec-fetch-site") &&
        !["same-origin", "same-site", "none"].includes(
          request.headers.get("sec-fetch-site")!,
        ))
    )
      return failure(403, "INVALID_ACCESS");
    const root = incoming.pathname === "/api/storefront/cart";
    const add =
      incoming.pathname === "/api/storefront/cart/items" && method === "POST";
    const editPath =
      /^\/api\/storefront\/cart\/items\/([a-f\d-]+)(\/editor)?$/iu.exec(
        incoming.pathname,
      );
    const editor = editPath?.[2] === "/editor" && method === "POST";
    const edit =
      !!editPath &&
      (editor || (!editPath[2] && ["PATCH", "DELETE"].includes(method)));
    if ((!root || !["GET", "POST"].includes(method)) && !add && !edit)
      return failure(400, "INVALID_COMMAND");
    const operation = edit
      ? editor
        ? "READ_CART_ITEM_EDITOR"
        : method === "PATCH"
          ? "UPDATE_CART_ITEM"
          : "REMOVE_CART_ITEM"
      : add
        ? "ADD_CART_ITEM"
        : method === "GET"
          ? "READ_CART"
          : "INITIALIZE_CART";
    const headers = new Headers({ accept: "application/json" });
    let body: string | undefined;
    let command;
    let cookie: string | undefined;
    try {
      cookie = cartCookie(request.headers.get("cookie"));
    } catch {
      return failure(401, "INVALID_ACCESS");
    }
    if (operation === "READ_CART" && !cookie)
      return failure(404, "CART_NOT_FOUND");
    try {
      if (cookie) headers.set("cookie", cookie);
      if (operation !== "INITIALIZE_CART" && !cookie)
        return failure(401, "INVALID_ACCESS");
      if (suppliedOrigin) headers.set("origin", suppliedOrigin);
      if (method === "GET") {
        if (
          [...incoming.searchParams.keys()].some(
            (key) => key !== "presentationLocale",
          ) ||
          incoming.searchParams.getAll("presentationLocale").length !== 1 ||
          request.body
        )
          return failure(400, "INVALID_COMMAND");
        command = cartRuntimeCommandSchema.parse({
          schemaVersion: 1,
          operation,
          presentationLocale: incoming.searchParams.get("presentationLocale"),
        });
      } else {
        if (
          incoming.search ||
          !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(
            request.headers.get("content-type") ?? "",
          )
        )
          return failure(400, "INVALID_COMMAND");
        const input: unknown = JSON.parse(
          await limitedText(request.body, 8192),
        );
        if (
          !input ||
          typeof input !== "object" ||
          Array.isArray(input) ||
          Object.hasOwn(input, "operation") ||
          Object.hasOwn(input, "itemId")
        )
          return failure(400, "INVALID_COMMAND");
        command = edit
          ? cartEditCommandSchema.parse({
              ...input,
              operation,
              itemId: editPath![1],
            })
          : cartRuntimeCommandSchema.parse({ ...input, operation });
        body = JSON.stringify(input);
        headers.set("content-type", "application/json");
        if (add || edit) {
          const csrf = request.headers.get("x-csrf-token") ?? "";
          if (!credential.test(csrf)) return failure(403, "INVALID_ACCESS");
          headers.set("x-csrf-token", csrf);
          if (!editor)
            headers.set(
              "idempotency-key",
              idempotencyKeySchema.parse(
                request.headers.get("idempotency-key"),
              ),
            );
        }
      }
    } catch {
      return failure(400, "INVALID_COMMAND");
    }
    const path = edit
      ? `/api/v1/cart/items/${editPath![1]}${editor ? "/editor" : ""}`
      : add
        ? "/api/v1/cart/items"
        : method === "POST"
          ? "/api/v1/carts"
          : `/api/v1/cart${incoming.search}`;
    mutationDispatched = add || (edit && !editor);
    const upstream = await (options.fetcher ?? fetch)(
      new URL(path, targetOrigin),
      {
        method,
        headers,
        ...(body ? { body } : {}),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (
      upstream.headers.get("cache-control") !== "private, no-store" ||
      !/^application\/json(?:;|$)/iu.test(
        upstream.headers.get("content-type") ?? "",
      )
    )
      return unavailable();
    const result = (
      editor
        ? cartEditorResponseSchema
        : edit
          ? cartEditResponseSchema
          : cartRuntimeCurrentResponseSchema
    ).parse(JSON.parse(await limitedText(upstream.body, 1_048_576)));
    if (
      result.outcome === "SUCCESS"
        ? upstream.status !== 200
        : !responseStatus(result.code).includes(upstream.status)
    )
      return unavailable();
    if (result.outcome === "SUCCESS") {
      if (
        edit &&
        (!("itemId" in command) ||
          !("cartItemId" in result) ||
          command.itemId.toLowerCase() !== result.cartItemId.toLowerCase())
      )
        return unavailable();
      if (result.action === "EDITOR_READ") {
        if (
          !("expectedCartVersion" in command) ||
          result.cartVersion !== command.expectedCartVersion ||
          result.itemVersion !== command.expectedItemVersion
        )
          return unavailable();
      } else if (
        result.cart.presentationLocale !== command.presentationLocale ||
        ("market" in command &&
          (command.market !== result.cart.market ||
            command.currency !== result.cart.currency)) ||
        !(
          edit
            ? method === "PATCH"
              ? ["UPDATED", "REPLAYED"]
              : ["REMOVED", "REPLAYED"]
            : add
              ? ["ADDED", "REPLAYED"]
              : method === "GET"
                ? ["READ"]
                : ["INITIALIZED"]
        ).includes(result.action)
      )
        return unavailable();
    }
    const responseHeaders = new Headers(privateHeaders);
    const cookies = upstream.headers.getSetCookie();
    if (cookies.length) {
      const clear =
        result.outcome === "FAILURE" && result.code === "CART_EXPIRED";
      if (
        cookies.length !== 1 ||
        (!clear &&
          (operation !== "INITIALIZE_CART" || result.outcome !== "SUCCESS")) ||
        !safeSetCookie(cookies[0]!, clear)
      )
        return unavailable();
      responseHeaders.set("set-cookie", cookies[0]!);
    }
    if (result.outcome === "SUCCESS") {
      const csrf = upstream.headers.get("x-csrf-token") ?? "";
      if (!credential.test(csrf)) return unavailable();
      if (
        operation === "INITIALIZE_CART" &&
        !headers.has("cookie") &&
        cookies.length !== 1
      )
        return unavailable();
      responseHeaders.set("x-csrf-token", csrf);
    }
    return Response.json(result, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return unavailable();
  }
}

export async function handleCartRequest(request: Request): Promise<Response> {
  try {
    const sources = { environment: process.env };
    return await proxyCartRequest(request, {
      siteOrigin: resolveServerRuntimeConfig(sources).siteOrigin,
      internalApiOrigin: resolveInternalApiRuntimeConfig(sources).origin,
    });
  } catch {
    return failure();
  }
}
