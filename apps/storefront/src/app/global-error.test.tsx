import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

type GlobalErrorProps = Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>;

type GlobalErrorModule = Readonly<{
  default: (props: GlobalErrorProps) => ReactElement;
}>;

async function loadGlobalErrorModule(): Promise<GlobalErrorModule> {
  let loaded: unknown;
  try {
    loaded = await import("./global-error.js");
  } catch {
    loaded = undefined;
  }

  expect(loaded, "storefront global error boundary must exist").toBeDefined();
  return loaded as GlobalErrorModule;
}

function findButton(node: ReactNode): ReactElement<{ onClick: () => void }> {
  if (typeof node === "object" && node !== null && "type" in node) {
    const element = node as ReactElement<{ children?: ReactNode }>;
    if (element.type === "button") {
      return element as ReactElement<{ onClick: () => void }>;
    }

    const children = element.props.children;
    for (const child of Array.isArray(children) ? children : [children]) {
      try {
        return findButton(child);
      } catch {
        // Continue until the single recovery button is found.
      }
    }
  }

  throw new Error("recovery button is missing");
}

test("renders only fixed recovery content without inspecting the error", async () => {
  const { default: GlobalError } = await loadGlobalErrorModule();
  const canary = "PRIVATE_STOREFRONT_ERROR_38427";
  let trapCalls = 0;
  const hostileError = new Proxy(new Error(), {
    get() {
      trapCalls += 1;
      throw new Error(canary);
    },
    getOwnPropertyDescriptor() {
      trapCalls += 1;
      throw new Error(canary);
    },
    getPrototypeOf() {
      trapCalls += 1;
      throw new Error(canary);
    },
    ownKeys() {
      trapCalls += 1;
      throw new Error(canary);
    },
  }) as Error;

  const markup = renderToStaticMarkup(
    GlobalError({ error: hostileError, reset: vi.fn() }),
  );

  expect(trapCalls).toBe(0);
  expect(markup).toContain("Storefront runtime is temporarily unavailable.");
  expect(markup).toContain("Try again");
  expect(markup).not.toContain(canary);
  expect(markup).not.toContain("stack");
  expect(markup).not.toContain("digest");
});

test("invokes reset from the recovery button", async () => {
  const { default: GlobalError } = await loadGlobalErrorModule();
  const reset = vi.fn();
  const tree = GlobalError({ error: new Error("ignored"), reset });

  findButton(tree).props.onClick();

  expect(reset).toHaveBeenCalledOnce();
});
