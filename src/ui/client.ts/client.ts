import type { ApiRequest, ApiResponse, ProjectView } from '../server/api';

/**
 * The UI's async data boundary. Two implementations:
 * - HttpClient: the real local dev API over POST /api (default when the server runs).
 * - DirectClient: an in-process Api with the same async shape, for tests and offline demo.
 * The UI only ever receives redacted ProjectViews - it never holds other members' files.
 */

export interface ClientData {
  call(req: ApiRequest): Promise<ApiResponse>;
}

export class HttpClient implements ClientData {
  constructor(public base: string) {}
  async call(req: ApiRequest): Promise<ApiResponse> {
    try {
      const res = await fetch(this.base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
      });
      return (await res.json()) as ApiResponse;
    } catch {
      return { ok: false, error: 'The local server could not be reached. Start it with: npm run server' };
    }
  }
}

/** Wraps anything with a synchronous call(ApiRequest): ApiResponse (the Api class). */
export class DirectClient implements ClientData {
  constructor(private api: { call(req: ApiRequest): ApiResponse }) {}
  async call(req: ApiRequest): Promise<ApiResponse> {
    return this.api.call(req);
  }
}

export type { ApiResponse, ProjectView };

/** Convenience: call an op and unwrap the common error shape. */
export async function op(client: ClientData, as: string, name: string, args: Record<string, unknown> = {}): Promise<ApiResponse> {
  return client.call({ as, op: name, args });
}
