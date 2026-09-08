import "server-only";
import { Suspense, type ComponentProps } from "react";
import type { StorefrontContextResponse } from "@fan-support/contracts";
import { MarketChoices, PolicyLinks } from "./commerce-context";

type MarketsProps = Omit<
  ComponentProps<typeof MarketChoices>,
  "context" | "headingLevel"
> & {
  context: Promise<StorefrontContextResponse>;
};
type PoliciesProps = Omit<ComponentProps<typeof PolicyLinks>, "context"> & {
  context: Promise<StorefrontContextResponse>;
};

async function Markets({ context, ...props }: MarketsProps) {
  return <MarketChoices {...props} context={await context} />;
}

/** Keep the same heading and reserved region while actual markets are loading. */
export function GiftDetailMarkets(props: MarketsProps) {
  return (
    <div className="gift-deferred-markets">
      <Suspense
        fallback={
          <section
            className="gift-market-choices"
            aria-busy="true"
            data-gift-context-pending
          >
            <h2>{props.copy.marketChoose}</h2>
            <p>{props.copy.marketChooseBody}</p>
            <p role="status">{props.copy.loading}</p>
          </section>
        }
      >
        <Markets {...props} />
      </Suspense>
    </div>
  );
}

async function Policies({ context, ...props }: PoliciesProps) {
  return <PolicyLinks {...props} context={await context} />;
}

export function GiftDetailPolicyLinks(props: PoliciesProps) {
  return (
    <div className="gift-deferred-policies">
      <Suspense
        fallback={
          <p role="status" aria-busy="true" data-gift-context-pending>
            {props.copy.loading}
          </p>
        }
      >
        <Policies {...props} />
      </Suspense>
    </div>
  );
}
