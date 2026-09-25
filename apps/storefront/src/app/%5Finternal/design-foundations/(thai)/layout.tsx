import type { ReactNode } from "react";

import "@fan-support/design-tokens/fonts/thai.css";

export default function ThaiFoundationLayout({
  children,
}: Readonly<{ children: ReactNode }>): ReactNode {
  return children;
}
