import { context } from "@opentelemetry/api";
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { StructuredLogger } from "./logging.js";
import {
  beginServerRequest,
  finishServerRequest,
  setServerRequestRoute,
  type ActiveServerRequest,
} from "./request-context.js";
import { REQUEST_ID_HEADER } from "./request-id.js";

type FastifyRequestState = {
  activeRequest: ActiveServerRequest;
  finished: boolean;
};

function finishFastifyRequest(
  state: FastifyRequestState | undefined,
  result: Readonly<{
    errorCode?: "INTERNAL_ERROR" | "REQUEST_ABORTED" | "REQUEST_TIMEOUT";
    statusCode: number;
  }>,
): void {
  if (state === undefined || state.finished) {
    return;
  }

  state.finished = true;
  context.with(state.activeRequest.context, () => {
    finishServerRequest(state.activeRequest, result);
  });
}

export function registerFastifyObservability(
  instance: FastifyInstance,
  options: Readonly<{
    logger: StructuredLogger;
    service: string;
  }>,
): void {
  const states = new WeakMap<FastifyRequest, FastifyRequestState>();

  instance.addHook("onRequest", (request, reply, done) => {
    const route = request.routeOptions.url;
    const activeRequest = beginServerRequest({
      service: options.service,
      method: request.method,
      route: typeof route === "string" ? route : "/unmatched",
      headers: request.headers,
      logger: options.logger,
    });
    states.set(request, { activeRequest, finished: false });
    void reply.header(
      REQUEST_ID_HEADER,
      activeRequest.requestContext.requestId,
    );
    context.with(activeRequest.context, done);
  });

  instance.addHook("preHandler", (request, _reply, done) => {
    const state = states.get(request);
    if (state === undefined) {
      done();
      return;
    }
    const route = request.routeOptions.url;
    if (typeof route === "string") {
      setServerRequestRoute(state.activeRequest, route);
    }
    context.with(state.activeRequest.context, done);
  });

  instance.addHook("onError", (request, _reply, _error, done) => {
    const state = states.get(request);
    if (state === undefined) {
      done();
      return;
    }
    context.with(state.activeRequest.context, done);
  });

  instance.addHook("onResponse", (request, reply, done) => {
    const state = states.get(request);
    try {
      finishFastifyRequest(state, { statusCode: reply.statusCode });
    } finally {
      done();
    }
  });

  instance.addHook("onRequestAbort", (request, done) => {
    const state = states.get(request);
    try {
      finishFastifyRequest(state, {
        errorCode: "REQUEST_ABORTED",
        statusCode: 499,
      });
    } finally {
      done();
    }
  });

  instance.addHook("onTimeout", (request, _reply, done) => {
    const state = states.get(request);
    try {
      finishFastifyRequest(state, {
        errorCode: "REQUEST_TIMEOUT",
        statusCode: 408,
      });
    } finally {
      done();
    }
  });
}
