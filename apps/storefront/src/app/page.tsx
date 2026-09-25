import { loadStorefrontRuntimeConfig } from "../server/runtime-config";

export const dynamic = "force-dynamic";

export default function StorefrontRuntimePage() {
  loadStorefrontRuntimeConfig();

  return (
    <main className="runtime-shell">
      <section className="runtime-card" aria-labelledby="runtime-title">
        <p className="runtime-kicker">Fan Support Platform</p>
        <h1 id="runtime-title">Storefront runtime is ready.</h1>
        <p>
          This internal preview confirms the independently deployable web
          runtime. Customer journeys begin in a later phase.
        </p>
        <a href="/healthz">View health response</a>
      </section>
    </main>
  );
}
