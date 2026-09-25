import { redirect } from "next/navigation";
import {
  loadAdminRuntimeConfig,
  loadAdminWorkspaceConfig,
} from "../server/runtime-config";

export const dynamic = "force-dynamic";

export default function AdminRuntimePage() {
  loadAdminRuntimeConfig();
  if (loadAdminWorkspaceConfig().mode === "TEST") redirect("/en");

  return (
    <main className="runtime-shell">
      <section className="runtime-card" aria-labelledby="runtime-title">
        <p className="runtime-kicker">Fan Support Platform</p>
        <h1 id="runtime-title">Admin runtime is ready.</h1>
        <p>
          This private preview confirms the independently deployable admin
          runtime. Authentication and operations arrive in later phases.
        </p>
        <a href="/healthz">View health response</a>
      </section>
    </main>
  );
}
