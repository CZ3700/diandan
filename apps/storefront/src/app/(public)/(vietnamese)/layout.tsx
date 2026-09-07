import type { ReactNode } from "react";
import "@fan-support/design-tokens/fonts/vietnamese.css";
import "../../../storefront/storefront.css";
export default function FontLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return children;
}
