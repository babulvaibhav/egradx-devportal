import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { currentCaller, currentContext, currentTraceId, errorBody, type EgradxCaller, isUuid } from '@babulvaibhav/egradx-sdk';
import { Prisma } from './generated/prisma/client.js';

/*
 * What the Java backend's Spring MVC does around its controllers, done the same way here: the errors in
 * the SDK's envelope by the SDK's rules (its GlobalExceptionHandler extends egradx-core's handler), Bean
 * Validation with its messages, Spring Data's paging, and Jackson's writing of LocalDateTime and BigDecimal.
 */

/** An OIM error, answered in the Java backend's envelope with this status and code. */
// docs:region error-handler
export class OimError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export const notFound = (message: string) => new OimError(404, 'NOT_FOUND', message);
export const conflict = (message: string) => new OimError(409, 'CONFLICT', message);
export const insufficientInventory = (message: string) => new OimError(409, 'INSUFFICIENT_INVENTORY', message);
export const invalidTransition = (message: string) => new OimError(400, 'INVALID_STATUS_TRANSITION', message);
export const invalidRequest = (message: string) => new OimError(400, 'INVALID_REQUEST', message);
export const tenantDenied = (message: string) => new OimError(403, 'TENANT_ACCESS_DENIED', message);
export const accessDenied = (message = 'You do not have permission to access this resource') => new OimError(403, 'ACCESS_DENIED', message);
// docs:end
/** What the SDK's handler answers for a body it can't read, as the Java backend's does. */
export const unreadableBody = () => invalidRequest('The request body could not be read');
/** What the SDK's handler answers for a path or query value of the wrong form (a malformed UUID, an unknown enum). */
export const invalidValue = (name: string, value: unknown) => invalidRequest(`Invalid value for '${name}': ${String(value)}`);
/** A failure the Java backend leaves to its catch-all: a 500 whose message reveals nothing. */
export const serverFault = (message: string) => new OimError(500, 'INTERNAL_ERROR', message);

/** The SDK's error envelope, with the request's ids. */
export function oimErrorBody(code: string, message: string) {
  return errorBody(code, message, currentContext()?.requestId ?? null, undefined, currentTraceId() ?? null);
}

/** Business routes' error handler; SDK errors from inside them keep their own codes, as Java's handler maps them. */
export function oimErrors() {
  return (error: unknown, _request: Request, response: Response, next: NextFunction) => {
    if (error instanceof OimError) {
      response.status(error.status).json(oimErrorBody(error.code, error.message));
      return;
    }
    const sdk = error as { status?: number; code?: string; message?: string } | undefined;
    if (sdk && typeof sdk.status === 'number' && sdk.status < 500 && typeof sdk.code === 'string') {
      response.status(sdk.status).json(oimErrorBody(sdk.code, sdk.message ?? ''));
      return;
    }
    if ((error as { type?: string } | undefined)?.type === 'entity.parse.failed') {
      response.status(400).json(oimErrorBody('INVALID_REQUEST', 'The request body could not be read'));
      return;
    }
    next(error);
  };
}

/**
 * As `@PreAuthorize("hasAuthority(...)")` with OIM's security chain: 401 from the entry point when not
 * signed in (SESSION_EXPIRED if a token was refused), 403 ACCESS_DENIED from the handler otherwise.
 */
export function caller(...anyOf: string[]): EgradxCaller {
  const signedIn = currentCaller();
  if (!signedIn) {
    throw Object.assign(new Error(), { unauthenticated: true });
  }
  if (anyOf.length && !anyOf.some((authority) => signedIn.authorities.has(authority))) {
    throw accessDenied();
  }
  return signedIn;
}

/** egradx-auth's entry point: 401, SESSION_EXPIRED when a token was refused, in the SDK's envelope. */
function unauthenticated(response: Response): void {
  const rejected = currentContext()?.rejectedToken;
  response.status(401).json(oimErrorBody(rejected ? 'SESSION_EXPIRED' : 'NOT_AUTHENTICATED',
    rejected ? 'Your session has ended — sign in again' : 'Sign in to continue'));
}

/** The entry point's 401, for business routes reached without a session. */
export function entryPoint() {
  return (error: unknown, _request: Request, response: Response, next: NextFunction) => {
    if ((error as { unauthenticated?: boolean } | undefined)?.unauthenticated) {
      unauthenticated(response);
      return;
    }
    next(error);
  };
}

/**
 * The Java backend's security chain, before any routing: only /egradx/auth/** (which checks each of its
 * own endpoints) and the open actuator endpoints are served to an anonymous caller. Everything else,
 * including a path that doesn't exist, is the entry point's 401.
 */
export function signedInOrOpen(): RequestHandler {
  const open = [/^\/egradx\/auth(\/|$)/, /^\/actuator\/(health|info|metrics|prometheus)(\/|$)/];
  return (request, response, next) => {
    if (currentCaller() || open.some((path) => path.test(request.path))) {
      next();
      return;
    }
    unauthenticated(response);
  };
}

interface RouterLike {
  stack: { route?: { _methods(): string[] }; handle: unknown; match(path: string): boolean; path?: string }[];
}

/** The methods the routes in `router` (and the routers within it) take at `path`. */
function methodsAt(router: RouterLike, path: string, found = new Set<string>()): Set<string> {
  for (const layer of router.stack) {
    if (!layer.match(path)) {
      continue;
    }
    if (layer.route) {
      layer.route._methods().forEach((method) => found.add(method));
    } else if (Array.isArray((layer.handle as Partial<RouterLike>)?.stack)) {
      methodsAt(layer.handle as RouterLike, path.slice((layer.path ?? '').length) || '/', found);
    }
  }
  return found;
}

/**
 * What no route answered, as Spring MVC answers it with the Java backend's handler: 405 when the path
 * exists for other methods (with Allow), else 404. In the Java backend's envelope.
 */
export function unmatched(router: unknown): RequestHandler {
  return (request, response) => {
    const allowed = methodsAt(router as RouterLike, request.path);
    if (allowed.size > 0) {
      response.set('Allow', [...allowed].join(', '));
      response.status(405).json(oimErrorBody('INVALID_REQUEST', `Request method '${request.method}' is not supported`));
      return;
    }
    response.status(404).json(oimErrorBody('NOT_FOUND', `No endpoint ${request.method} ${request.path}`));
  };
}

/** An async route, its failures handed to the error handlers. */
export const route = (handler: (request: Request, response: Response) => Promise<unknown>): RequestHandler =>
  async (request, response, next) => {
    try {
      await handler(request, response);
    } catch (error) {
      next(error);
    }
  };

// --- binding and validation --------------------------------------------------------------------

export type Body = Record<string, unknown>;
type Rule = (value: unknown) => string | undefined;

/** Bean Validation, with the messages the Java request records declare. */
export const rules = {
  notBlank: (message: string): Rule => (v) => (typeof v !== 'string' || !v.trim() ? message : undefined),
  notNull: (message: string): Rule => (v) => (v === null || v === undefined ? message : undefined),
  notEmpty: (message: string): Rule => (v) => (!Array.isArray(v) || v.length === 0 ? message : undefined),
  maxLength: (max: number, message: string): Rule => (v) => (typeof v === 'string' && v.length > max ? message : undefined),
  positive: (message: string): Rule => (v) => (typeof v === 'number' && !(v > 0) ? message : undefined),
  range: (min: number, max: number, message: string): Rule => (v) => (typeof v === 'number' && (v < min || v > max) ? message : undefined),
  email: (message: string): Rule => (v) => (typeof v === 'string' && v !== '' && !/^[^\s@.]+(\.[^\s@.]+)*@[^\s@.]+(\.[^\s@.]+)*$/.test(v) ? message : undefined),
  decimalMin: (min: string, message: string): Rule => (v) => (v !== null && v !== undefined && new Prisma.Decimal(String(v)).lessThan(min) ? message : undefined),
  digits: (integer: number, fraction: number, message: string): Rule => (v) => {
    if (v === null || v === undefined) {
      return undefined;
    }
    const decimal = new Prisma.Decimal(String(v));
    const fractionDigits = Math.max(0, decimal.decimalPlaces());
    const integerDigits = decimal.abs().truncated().toFixed(0).replace(/^0$/, '').length;
    return integerDigits > integer || fractionDigits > fraction ? message : undefined;
  },
};

export type FieldKind = 'string' | 'uuid' | 'integer' | 'decimal' | 'array' | 'object' | `enum:${string}`;

/**
 * Binds a JSON body as Jackson binds a Java record (a value of the wrong type cannot be read: the Java
 * handler's 500), then validates it, joining the messages with ", " as the Java handler does.
 */
export function bind(request: Request, fields: Record<string, { kind: FieldKind; rules?: Rule[] }>): Body {
  // As Spring reads an @RequestBody: a body that isn't JSON is 415; no type and no body is "missing" below.
  const type = request.get('Content-Type');
  const hasBody = Number(request.get('Content-Length') ?? 0) > 0 || request.get('Transfer-Encoding') !== undefined;
  if (type ? !request.is(['application/json', 'application/*+json']) : hasBody) {
    throw new OimError(415, 'INVALID_REQUEST', `Content-Type '${mediaType(type ?? 'application/octet-stream')}' is not supported`);
  }
  const raw: unknown = request.body;
  if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw unreadableBody();
  }
  const body = bindObject(raw as Body, fields);
  const messages = Object.entries(fields).flatMap(([name, field]) => (field.rules ?? []).map((rule) => rule(body[name])).filter((m): m is string => !!m));
  if (messages.length) {
    throw invalidRequest(messages.join(', '));
  }
  return body;
}

/**
 * A Content-Type as Spring reports it: type and subtype lower-cased, no spaces around parameters, and
 * `charset=UTF-8` added when the request named none (Spring Boot's encoding filter sets the request's).
 */
function mediaType(header: string): string {
  const [essence = '', ...parameters] = header.split(';').map((part) => part.trim()).filter(Boolean);
  const written = parameters.map((parameter) => parameter.replace(/\s*=\s*/, '='));
  if (!written.some((parameter) => /^charset=/i.test(parameter))) {
    written.push('charset=UTF-8');
  }
  return [essence.toLowerCase(), ...written].join(';');
}

export function bindObject(raw: Body, fields: Record<string, { kind: FieldKind; rules?: Rule[] }>): Body {
  const body: Body = {};
  for (const [name, field] of Object.entries(fields)) {
    const value = raw[name];
    if (value === null || value === undefined) {
      body[name] = null;
      continue;
    }
    body[name] = convert(name, value, field.kind);
  }
  return body;
}

function convert(name: string, value: unknown, kind: FieldKind): unknown {
  const fail = () => unreadableBody();
  if (kind === 'string') {
    if (typeof value === 'object') {
      throw fail();
    }
    return String(value);
  }
  if (kind === 'uuid') {
    if (!isUuid(value)) {
      throw fail();
    }
    return value.toLowerCase();
  }
  if (kind === 'integer') {
    const number = typeof value === 'string' && /^-?\d+$/.test(value.trim()) ? Number(value) : value;
    if (typeof number !== 'number' || !Number.isInteger(number) || Math.abs(number) > 2_147_483_647) {
      throw fail();
    }
    return number;
  }
  if (kind === 'decimal') {
    if (typeof value !== 'number' && !(typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim()))) {
      throw fail();
    }
    return typeof value === 'string' ? value.trim() : value;
  }
  if (kind === 'array') {
    if (!Array.isArray(value)) {
      throw fail();
    }
    return value;
  }
  if (kind === 'object') {
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw fail();
    }
    return value;
  }
  const allowed = kind.slice('enum:'.length).split('|');
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw fail();
  }
  return value;
}

/** A UUID path variable; a malformed one is what Spring's conversion refuses (the SDK handler's 400). */
export function uuidParam(request: Request, name: string): string {
  const value = request.params[name];
  if (!isUuid(value)) {
    throw invalidValue(name, value);
  }
  return value.toLowerCase();
}

/** An optional query parameter of an enum or UUID type, refused as Spring's conversion refuses it. */
export function queryParam(request: Request, name: string, kind: 'string' | 'uuid' | `enum:${string}`): string | null {
  const raw = request.query[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const text = String(value);
  if (kind === 'uuid' && !isUuid(text)) {
    throw invalidValue(name, text);
  }
  if (kind.startsWith('enum:') && !kind.slice(5).split('|').includes(text)) {
    throw invalidValue(name, text);
  }
  return kind === 'uuid' ? text.toLowerCase() : text;
}

// --- Spring Data paging ------------------------------------------------------------------------

export interface Pageable {
  page: number;
  size: number;
  sort: { property: string; direction: 'asc' | 'desc' }[];
}

/** page from 0, size 20 by default and at most 100 (OIM's spring.data.web.pageable), sort=field[,asc|desc]. */
export function pageable(request: Request, defaultSize = 20, maxSize = 100): Pageable {
  const number = (name: string) => {
    const raw = request.query[name];
    const text = Array.isArray(raw) ? raw[0] : raw;
    return typeof text === 'string' && /^-?\d+$/.test(text.trim()) ? Number(text.trim()) : undefined;
  };
  const page = Math.max(0, number('page') ?? 0);
  let size = Math.min(number('size') ?? defaultSize, maxSize);
  if (size < 1) {
    size = defaultSize;
  }
  const sort: Pageable['sort'] = [];
  for (const parameter of ([] as unknown[]).concat(request.query.sort ?? []).filter((s): s is string => typeof s === 'string')) {
    const parts = parameter.split(',').map((p) => p.trim()).filter(Boolean);
    const last = parts.at(-1)?.toLowerCase();
    const direction = last === 'desc' || last === 'asc' ? last : 'asc';
    (last === 'desc' || last === 'asc' ? parts.slice(0, -1) : parts).forEach((property) => sort.push({ property, direction }));
  }
  return { page, size, sort };
}

/** Prisma's orderBy for a Pageable; a property the entity lacks fails as Spring Data fails on it. */
export function orderBy(request: Pageable, entity: string, properties: readonly string[]): Record<string, 'asc' | 'desc'>[] {
  return request.sort.map(({ property, direction }) => {
    if (!properties.includes(property)) {
      throw serverFault(`No property '${property}' found for type '${entity}'`);
    }
    return { [property]: direction };
  });
}

/** A page as Spring Data's PageImpl serializes. */
export function page<T>(content: T[], total: number, request: Pageable) {
  const sorted = request.sort.length > 0;
  const sort = { empty: !sorted, sorted, unsorted: !sorted };
  const totalPages = Math.ceil(total / request.size);
  return {
    content,
    pageable: { pageNumber: request.page, pageSize: request.size, sort, offset: request.page * request.size, paged: true, unpaged: false },
    last: request.page + 1 >= totalPages,
    totalElements: total,
    totalPages,
    size: request.size,
    number: request.page,
    sort,
    first: request.page === 0,
    numberOfElements: content.length,
    empty: content.length === 0,
  };
}

// --- writing as Jackson writes -----------------------------------------------------------------

type RawJson = { readonly rawJSON: string };
const rawJson = (JSON as unknown as { rawJSON(text: string): RawJson }).rawJSON;

/** A NUMERIC(10,2) as Jackson writes a BigDecimal of scale 2: 25.00, not 25. */
export const money = (value: Prisma.Decimal | null) => (value === null ? null : rawJson(value.toFixed(2)));

/** The same value as plain JSON data: what audit records keep. */
export const plain = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));
