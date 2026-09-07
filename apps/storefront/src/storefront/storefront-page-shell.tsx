import "server-only";
import { Suspense, type ComponentProps, type ReactNode } from "react";
import { PolicyLinks } from "./commerce-context";
import { readCommerceContext } from "./storefront-page-reads";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./page-parts";

export type StorefrontPageProps = Readonly<{
  searchParams: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
  params: Promise<{ handle?: string }>;
}>;

type ShellProps = ComponentProps<typeof SiteHeader> &
  Readonly<{ children: ReactNode }>;
type PolicyProps = Pick<ShellProps, "locale" | "copy" | "contextQuery">;

async function FooterPolicyLinks(props: PolicyProps) {
  return <PolicyLinks {...props} context={await readCommerceContext()} />;
}

export function StorefrontPageShell({
  children,
  active,
  ...props
}: ShellProps) {
  return (
    <div className="storefront" lang={props.locale}>
      <SiteHeader {...props} active={active} />
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
      <SiteFooter
        {...props}
        policyLinks={
          <Suspense fallback={null}>
            <FooterPolicyLinks
              locale={props.locale}
              copy={props.copy}
              contextQuery={props.contextQuery}
            />
          </Suspense>
        }
      />
    </div>
  );
}
