import type { ReactNode } from "react";
import "@fan-support/design-tokens/fonts/latin.css";
import "../../../storefront/storefront.css";
export default function FontLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return children;
}
