import { loadAdminWorkspaceConfig } from "../../../../../server/runtime-config";
import { createAdminAccessBff } from "../../../../../server/admin-access-bff";
import { adminError } from "../../../../../server/admin-api-client";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  try {
    return await createAdminAccessBff({
      config: loadAdminWorkspaceConfig(),
    }).callback(request);
  } catch {
    return adminError("ACCESS_UNAVAILABLE", 503);
  }
}
function unsupported(): Response {
  return adminError("NOT_FOUND", 404);
}
export const POST = unsupported;
export const PUT = unsupported;
export const PATCH = unsupported;
export const DELETE = unsupported;
export const HEAD = unsupported;
export const OPTIONS = unsupported;
