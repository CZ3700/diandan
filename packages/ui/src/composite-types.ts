import type {
  CurrencyCode,
  MinorAmount,
  SupportedLocale,
} from "@fan-support/contracts";

export type CompositeAction = Readonly<{
  href: string;
  label: string;
}>;

export type CompositeLoadingState = Readonly<{
  label: string;
  state: "loading";
}>;

export type CompositeEmptyState = Readonly<{
  action?: CompositeAction;
  description?: string;
  state: "empty";
  title: string;
}>;

export type CompositeErrorState = Readonly<{
  action?: CompositeAction;
  description: string;
  state: "error";
  title: string;
}>;

export type CompositeUnavailableState =
  CompositeLoadingState | CompositeEmptyState | CompositeErrorState;

export type CompositeView<Ready> =
  CompositeUnavailableState | (Readonly<{ state: "ready" }> & Ready);

export type CompositeMoney = Readonly<{
  amountMinor: MinorAmount;
  currency: CurrencyCode;
  locale: SupportedLocale;
}>;

export type CompositeFocalPoint = Readonly<{
  x: number;
  y: number;
}>;

export type CompositeMediaResource = Readonly<{
  focalPoint: CompositeFocalPoint;
  height: number;
  sizes?: string;
  src: string;
  srcSet?: string;
  width: number;
}>;

export type CompositeMedia = CompositeMediaResource &
  Readonly<{
    alt: string;
    fallbackLabel: string;
    state: "error" | "ready";
  }>;

export type CompositeResponsiveMedia = Readonly<{
  alt: string;
  desktop: CompositeMediaResource;
  fallbackLabel: string;
  mobile: CompositeMediaResource;
  state: "error" | "ready";
}>;
