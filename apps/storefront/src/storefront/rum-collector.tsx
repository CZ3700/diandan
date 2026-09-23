"use client";
import { useEffect } from "react";
import type { SupportedLocale } from "@fan-support/contracts";
import { startBrowserRum } from "./rum-client";
export function RumCollector({
  locale,
  samplePermille,
}: Readonly<{ locale: SupportedLocale; samplePermille: number }>) {
  useEffect(() => {
    void startBrowserRum({ locale, samplePermille });
  }, [locale, samplePermille]);
  return null;
}
