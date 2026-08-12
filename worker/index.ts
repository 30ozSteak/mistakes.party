/** Cloudflare Worker entry point for Mistakes.party. */
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response> | Response;
  };
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const worker = {
  fetch(request: Request, env: Env, ctx: WorkerExecutionContext) {
    return handler.fetch(request, env, ctx);
  },
};

export default worker;
