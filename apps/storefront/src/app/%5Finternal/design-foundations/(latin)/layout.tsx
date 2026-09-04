import type { ReactNode } from "react";

import "@fan-support/design-tokens/fonts/latin.css";

export default function LatinFoundationLayout({
  children,
}: Readonly<{ children: ReactNode }>): ReactNode {
  return children;
}
