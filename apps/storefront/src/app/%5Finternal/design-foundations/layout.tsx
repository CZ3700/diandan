import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { isDesignFoundationPreviewEnabled } from "../../../design-foundations";
import { loadStorefrontRuntimeConfig } from "../../../server/runtime-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Design foundations · Internal specimen",
  description: "Internal typography, color, and responsive design proof.",
  robots: { follow: false, index: false },
};

export default function DesignFoundationLayout({
  children,
}: Readonly<{ children: ReactNode }>): ReactNode {
  if (
    !isDesignFoundationPreviewEnabled(process.env["FAN_SUPPORT_DEPLOYMENT_ENV"])
  ) {
    notFound();
  }

  loadStorefrontRuntimeConfig();
  return children;
}
