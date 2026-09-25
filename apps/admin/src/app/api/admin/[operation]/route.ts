import { loadAdminWorkspaceConfig } from "../../../../server/runtime-config";
import { createAdminBff } from "../../../../server/admin-bff";
import { adminError } from "../../../../server/admin-api-client";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ operation: string }> },
): Promise<Response> {
  try {
    return await createAdminBff({
      config: loadAdminWorkspaceConfig(),
    }).operation(request, (await context.params).operation);
  } catch {
    return adminError("CONTENT_UNAVAILABLE", 503);
  }
}
export function GET(): Response {
  return adminError("NOT_FOUND", 404);
}

export function PUT(): Response {
  return adminError("NOT_FOUND", 404);
}
export function PATCH(): Response {
  return adminError("NOT_FOUND", 404);
}
export function DELETE(): Response {
  return adminError("NOT_FOUND", 404);
}
export function OPTIONS(): Response {
  return adminError("NOT_FOUND", 404);
}
export function HEAD(): Response {
  return adminError("NOT_FOUND", 404);
}
