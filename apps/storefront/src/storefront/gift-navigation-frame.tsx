"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { GiftNavigationPending } from "./gift-navigation-context";

/**
 * User request 2026-09-30 (L2-17): choosing a kind, a price order or a page changes the
 * gifts in place. Every control inside is a real link marked `data-gift-nav`; this frame
 * follows it without a full page load, keeps the scroll position and leaves the current
 * list on screen until the next one is ready. Without script the links navigate as usual.
 */
export function GiftNavigationFrame({
  children,
}: Readonly<{ children: ReactNode }>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<string>();
  const frame = useRef<HTMLDivElement>(null);
  const reveal = useRef(false);

  useEffect(() => {
    if (pending || !reveal.current) return;
    reveal.current = false;
    const element = frame.current;
    if (!element) return;
    // A new page starts at the top of the gifts, never at the top of the document.
    if (element.getBoundingClientRect().top < 0) {
      const still =
        window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        document.documentElement.dataset["storefrontMotion"] === "NONE";
      element.scrollIntoView({
        block: "start",
        behavior: still ? "auto" : "smooth",
      });
    }
    if (!element.contains(document.activeElement))
      element.focus({ preventScroll: true });
  }, [pending]);

  function follow(event: MouseEvent<HTMLDivElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      !(event.target instanceof Element)
    )
      return;
    const link = event.target.closest<HTMLAnchorElement>("a[data-gift-nav]");
    if (!link || (link.target && link.target !== "_self")) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    event.preventDefault();
    const next = link.dataset["giftNav"] ?? "";
    reveal.current = next === "page";
    setTarget(next);
    startTransition(() => {
      // The fan is already at the gifts: the link's `#gifts` would scroll back to their top.
      router.push(`${url.pathname}${url.search}`, { scroll: false });
    });
  }

  return (
    <GiftNavigationPending value={pending ? target : undefined}>
      <div
        ref={frame}
        className="gift-navigation"
        data-gift-navigation
        data-gift-pending={pending ? target : undefined}
        aria-busy={pending || undefined}
        tabIndex={-1}
        onClick={follow}
      >
        {children}
      </div>
    </GiftNavigationPending>
  );
}
