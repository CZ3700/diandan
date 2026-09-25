import { handleInternalObservabilityRequest } from "../../../server/observability-probe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  return handleInternalObservabilityRequest(request);
}
