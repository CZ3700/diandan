import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";

import {
  createSafeRuntimeError,
  REQUEST_ID_HEADER,
} from "@fan-support/observability";
import { currentRequestContext } from "@fan-support/observability/node";

function readStatusCode(exception: unknown): number {
  try {
    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : 500;
    return Number.isInteger(statusCode) &&
      statusCode >= 400 &&
      statusCode <= 599
      ? statusCode
      : 500;
  } catch {
    return 500;
  }
}

@Catch()
export class SafeHttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const statusCode = readStatusCode(exception);
    const requestId =
      currentRequestContext()?.requestId ?? reply.getHeader(REQUEST_ID_HEADER);
    const body = createSafeRuntimeError(statusCode, requestId);

    void reply.header(REQUEST_ID_HEADER, body.requestId);
    void reply.status(statusCode).send(body);
  }
}
