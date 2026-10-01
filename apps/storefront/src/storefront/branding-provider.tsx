"use client";
import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  createDefaultStorefrontBrandView,
  type PublicStorefrontBrandResponse,
  type StorefrontBrandView,
} from "@fan-support/contracts";

type BrandingContext = Readonly<{
  brand: StorefrontBrandView;
  source: "DEFAULT" | "PUBLISHED" | "FALLBACK" | "PREVIEW";
  version: number | undefined;
  setPreview: Dispatch<SetStateAction<StorefrontBrandView | null>>;
}>;
const context = createContext<BrandingContext>({
  brand: createDefaultStorefrontBrandView(),
  source: "DEFAULT",
  version: 0,
  setPreview: () => {},
});
export const useStorefrontBrand = () => useContext(context);

/** One SSR read supplies every page; only BrandPreview can install an ephemeral draft. */
export function BrandingProvider({
  result,
  children,
}: Readonly<{
  result: PublicStorefrontBrandResponse | null;
  children: ReactNode;
}>) {
  const [preview, setPreview] = useState<StorefrontBrandView | null>(null);
  const published = result?.outcome === "SUCCESS" ? result : null;
  const value: BrandingContext = {
    brand: preview ?? published?.brand ?? createDefaultStorefrontBrandView(),
    source: preview
      ? "PREVIEW"
      : (published?.source ?? (result ? "FALLBACK" : "DEFAULT")),
    version: preview
      ? undefined
      : (published?.version ?? (result ? undefined : 0)),
    setPreview,
  };
  return <context.Provider value={value}>{children}</context.Provider>;
}
