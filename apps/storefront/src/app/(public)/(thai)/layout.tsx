import type { ReactNode } from "react";
import "@fan-support/design-tokens/fonts/thai.css";
import "../../../storefront/storefront.css";
import "../../../storefront/gift-directory.css";
import "../../../storefront/gift-detail.css";
export default function FontLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return children;
}
