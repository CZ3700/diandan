"use client";
import { useEffect, useState, type ComponentType } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import type { StorefrontCopy } from "./copy";
type Props = Readonly<{
  locale: SupportedLocale;
  copy: StorefrontCopy;
  contextQuery: string;
  page?: boolean;
}>;
export function CartPanel(props: Props) {
  const [Body, setBody] = useState<ComponentType<Props> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void import("./cart-body").then(
      (module) => {
        if (active) setBody(() => module.CartBody);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, []);
  if (Body) return <Body {...props} />;
  if (failed)
    return (
      <div role="alert">
        <p>{props.copy.cartLoadError}</p>
        <a href={window.location.href}>{props.copy.cartRetry}</a>
      </div>
    );
  return <p role="status">{props.copy.loading}</p>;
}
