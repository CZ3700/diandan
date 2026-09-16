import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

test.each([false, true])(
  "carries the restoration hint %s without treating it as a cart read result",
  async (restoreOnLoad) => {
    const subject = await import("./cart-provider");
    expect(subject.useCartRestorationHint).toBeTypeOf("function");
    function Probe() {
      const session = subject.useCartSession();
      return (
        <span
          data-restore={String(subject.useCartRestorationHint())}
          data-status={session?.snapshot().status}
        />
      );
    }
    const html = renderToStaticMarkup(
      <subject.CartProvider locale="en" restoreOnLoad={restoreOnLoad}>
        <Probe />
      </subject.CartProvider>,
    );
    expect(html).toContain(`data-restore="${restoreOnLoad}"`);
    expect(html).toContain('data-status="idle"');
  },
);
