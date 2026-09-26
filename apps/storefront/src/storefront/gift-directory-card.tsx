import type {
  GiftDirectoryResponse,
  SupportedLocale,
} from "@fan-support/contracts";
import type { StorefrontCopy } from "./copy";
import { GiftCard } from "./gift-card";

type DirectoryItem = Extract<
  GiftDirectoryResponse,
  { outcome: "SUCCESS" }
>["items"][number];

export function GiftDirectoryCard({
  item,
  ...props
}: Readonly<{
  item: DirectoryItem;
  locale: SupportedLocale;
  copy: StorefrontCopy;
  contextQuery: string;
  headingLevel: 2 | 3;
}>) {
  return <GiftCard {...props} gift={item.gift} offer={item.offer} />;
}
