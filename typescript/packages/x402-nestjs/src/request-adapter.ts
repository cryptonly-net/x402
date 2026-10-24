import type { HTTPAdapter, HTTPRequestContext } from '@x402/core/server';

/** What the Express and Fastify request objects have in common. */
export type PlatformRequest = {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  query?: unknown;
  body?: unknown;
  protocol?: string;
  /** Express only. */
  path?: string;
  /** Express only. */
  originalUrl?: string;
};

/** What the Express response and the Fastify reply have in common. */
export type PlatformResponse = {
  statusCode: number;
  header(name: string, value: string): unknown;
  getHeader(name: string): unknown;
  getHeaders(): Record<string, unknown>;
  removeHeader(name: string): unknown;
};

/** `@x402/core`'s view of a request on either Nest platform. */
export class NestRequestAdapter implements HTTPAdapter {
  constructor(private readonly req: PlatformRequest) {}

  getHeader(name: string): string | undefined {
    const value = this.req.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }

  getMethod(): string {
    return this.req.method;
  }

  getPath(): string {
    return this.req.path ?? this.req.url.split('?')[0];
  }

  getUrl(): string {
    const protocol = this.req.protocol ?? 'http';
    return `${protocol}://${this.getHeader('host') ?? ''}${this.req.originalUrl ?? this.req.url}`;
  }

  getAcceptHeader(): string {
    return this.getHeader('accept') ?? '';
  }

  getUserAgent(): string {
    return this.getHeader('user-agent') ?? '';
  }

  getQueryParams(): Record<string, string | string[]> {
    return (this.req.query ?? {}) as Record<string, string | string[]>;
  }

  getQueryParam(name: string): string | string[] | undefined {
    return this.getQueryParams()[name];
  }

  getBody(): unknown {
    return this.req.body;
  }
}

/** The `@x402/core` request context of a Nest request. */
export function requestContextOf(req: PlatformRequest): HTTPRequestContext {
  const adapter = new NestRequestAdapter(req);
  const path = adapter.getPath();
  let decodedPath = path;
  try {
    decodedPath = decodeURIComponent(path);
  } catch {
    // Keep the raw path; route matching then fails closed.
  }
  return {
    adapter,
    path,
    decodedPath,
    method: req.method,
    paymentHeader: adapter.getHeader('payment-signature') ?? adapter.getHeader('x-payment'),
  };
}

/** Sets each header on the response. */
export function setHeaders(res: PlatformResponse, headers: Record<string, string>): void {
  for (const [name, value] of Object.entries(headers)) res.header(name, String(value));
}

/** The response's headers as strings. */
export function headersOf(res: PlatformResponse): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(res.getHeaders())) {
    if (value != null) headers[name] = String(value);
  }
  return headers;
}

/** A header's value as a string, or `null` when unset. */
export function headerOf(res: PlatformResponse, name: string): string | null {
  const value = res.getHeader(name);
  return value == null ? null : String(value);
}
