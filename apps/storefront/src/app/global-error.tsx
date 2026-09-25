"use client";

import { createElement } from "react";

type GlobalErrorProps = Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>;

export default function GlobalError({ reset }: GlobalErrorProps) {
  return createElement(
    "html",
    { lang: "en" },
    createElement(
      "body",
      null,
      createElement(
        "main",
        { className: "runtime-shell" },
        createElement(
          "section",
          { "aria-labelledby": "error-title", className: "runtime-card" },
          createElement(
            "p",
            { className: "runtime-kicker" },
            "Fan Support Platform",
          ),
          createElement(
            "h1",
            { id: "error-title" },
            "Storefront runtime is temporarily unavailable.",
          ),
          createElement(
            "p",
            null,
            "The request could not be completed safely. Please try again.",
          ),
          createElement(
            "button",
            { onClick: reset, type: "button" },
            "Try again",
          ),
        ),
      ),
    ),
  );
}
