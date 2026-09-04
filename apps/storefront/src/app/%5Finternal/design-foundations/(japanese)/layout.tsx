import type { ReactNode } from "react";

import "@fan-support/design-tokens/fonts/japanese.css";

export default function JapaneseFoundationLayout({
  children,
}: Readonly<{ children: ReactNode }>): ReactNode {
  return children;
}
