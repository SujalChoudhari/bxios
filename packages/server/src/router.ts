import {
  ValidationError,
  HttpError,
  formatZodIssues,
  createErrorTupleFrame
} from './validation.js';
import { ZodError } from 'zod';

export type ParamType = 'body' | 'query' | 'param' | 'headers' | 'context';

export interface ParamMetadata {
  index: number;
  type: ParamType;
  key?: string;
  schema?: any;
}

export interface MethodRouteMetadata {
  httpMethod: string;
  path: string;
  propertyKey: string | symbol;
}

export interface ControllerMetadata {
  prefix: string;
}

export interface RequestContext {
  method?: string;
  path?: string;
  url?: string;
  body?: any;
  query?: Record<string, any>;
  params?: Record<string, any>;
  headers?: Record<string, any>;
  context?: any;
  [key: string]: any;
}

export interface RouteDefinition {
  httpMethod: string;
  path: string;
  fullPath: string;
  propertyKey: string | symbol;
  handler: Function;
  instance: any;
  paramMetadata: ParamMetadata[];
  regex: RegExp;
  paramNames: string[];
}

export interface RouteMatch {
  route: RouteDefinition;
  params: Record<string, string>;
  handler: Function;
  instance: any;
}

const CONTROLLER_METADATA_KEY = Symbol('bxios:controller');
const ROUTE_METADATA_KEY = Symbol('bxios:routes');
const PARAM_METADATA_KEY = Symbol('bxios:params');

/**
 * Controller class decorator
 */
export function Controller(prefix: string = ''): ClassDecorator {
  return (target: any) => {
    target[CONTROLLER_METADATA_KEY] = {
      prefix: prefix || ''
    } as ControllerMetadata;
  };
}

/**
 * Generic HTTP method decorator
 */
export function Route(httpMethod: string, path: string = ''): MethodDecorator {
  return (target: any, propertyKey: string | symbol, _descriptor: PropertyDescriptor) => {
    if (!target[ROUTE_METADATA_KEY]) {
      target[ROUTE_METADATA_KEY] = [];
    }
    target[ROUTE_METADATA_KEY].push({
      httpMethod: httpMethod.toUpperCase(),
      path: path || '',
      propertyKey
    } as MethodRouteMetadata);
  };
}

export function Get(path: string = ''): MethodDecorator {
  return Route('GET', path);
}

export function Post(path: string = ''): MethodDecorator {
  return Route('POST', path);
}

export function Put(path: string = ''): MethodDecorator {
  return Route('PUT', path);
}

export function Delete(path: string = ''): MethodDecorator {
  return Route('DELETE', path);
}

export function Patch(path: string = ''): MethodDecorator {
  return Route('PATCH', path);
}

/**
 * Parameter decorator factory supporting key and/or Zod schema
 */
export function createParamDecorator(type: ParamType) {
  return (keyOrSchema?: string | any, schema?: any): ParameterDecorator => {
    let key: string | undefined;
    let paramSchema: any;

    if (typeof keyOrSchema === 'string') {
      key = keyOrSchema;
      paramSchema = schema;
    } else if (keyOrSchema !== undefined && keyOrSchema !== null) {
      key = undefined;
      paramSchema = keyOrSchema;
    }

    return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
      if (!propertyKey) return;
      if (!target[PARAM_METADATA_KEY]) {
        target[PARAM_METADATA_KEY] = new Map<string | symbol, ParamMetadata[]>();
      }
      const paramMap: Map<string | symbol, ParamMetadata[]> = target[PARAM_METADATA_KEY];
      if (!paramMap.has(propertyKey)) {
        paramMap.set(propertyKey, []);
      }
      paramMap.get(propertyKey)!.push({
        index: parameterIndex,
        type,
        key,
        schema: paramSchema
      });
    };
  };
}

export const Body = createParamDecorator('body');
export const Query = createParamDecorator('query');
export const Param = createParamDecorator('param');
export const Headers = createParamDecorator('headers');
export const Context = createParamDecorator('context');

/**
 * Normalize path slashes
 */
export function normalizePath(path: string): string {
  if (!path) return '/';
  let normalized = path.replace(/\/+/g, '/');
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized;
  }
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * Combine controller prefix and route path
 */
export function combinePaths(prefix: string, routePath: string): string {
  const p = normalizePath(prefix);
  const r = normalizePath(routePath);
  if (p === '/') return r;
  if (r === '/') return p;
  return normalizePath(p + r);
}

/**
 * Convert route path pattern into a regex and parameter names list
 */
export function pathToRegex(pathPattern: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const normalized = normalizePath(pathPattern);

  const regexPath = normalized
    .replace(/([.+?^${}()|[\]\\])/g, '\\$1')
    .replace(/:([a-zA-Z0-9_]+)/g, (_, paramName) => {
      paramNames.push(paramName);
      return '([^/]+)';
    })
    .replace(/\*/g, () => {
      paramNames.push('*');
      return '(.*)';
    });

  const regex = new RegExp(`^${regexPath}$`);
  return { regex, paramNames };
}

/**
 * Extract parameter value from request context and apply Zod schema validation if attached
 */
async function extractParamValue(pm: ParamMetadata, req: RequestContext): Promise<any> {
  let val: any;
  switch (pm.type) {
    case 'body':
      val = pm.key ? req.body?.[pm.key] : req.body;
      break;
    case 'query':
      val = pm.key ? req.query?.[pm.key] : req.query;
      break;
    case 'param':
      val = pm.key ? req.params?.[pm.key] : req.params;
      break;
    case 'headers':
      if (pm.key) {
        if (!req.headers) {
          val = undefined;
        } else {
          const targetKey = pm.key.toLowerCase();
          for (const [k, v] of Object.entries(req.headers)) {
            if (k.toLowerCase() === targetKey) {
              val = v;
              break;
            }
          }
        }
      } else {
        val = req.headers;
      }
      break;
    case 'context':
      if (pm.key) {
        val = req.context?.[pm.key] ?? req[pm.key];
      } else {
        val = req.context !== undefined ? req.context : req;
      }
      break;
    default:
      val = undefined;
  }

  if (pm.schema) {
    try {
      // Prefer the async API when available so schemas with async refinements
      // still produce the same 400 validation response as synchronous schemas.
      const parseFn = typeof pm.schema.safeParseAsync === 'function'
        ? pm.schema.safeParseAsync.bind(pm.schema)
        : typeof pm.schema.safeParse === 'function'
          ? pm.schema.safeParse.bind(pm.schema)
          : undefined;

      if (parseFn) {
        const parseRes = await parseFn(val);
        if (!parseRes.success) {
          const details = formatZodIssues(parseRes.error.issues);
          throw new ValidationError('Validation failed', details);
        }
        return parseRes.data;
      }

      const parseMethod = typeof pm.schema.parseAsync === 'function'
        ? pm.schema.parseAsync.bind(pm.schema)
        : typeof pm.schema.parse === 'function'
          ? pm.schema.parse.bind(pm.schema)
          : undefined;

      if (parseMethod) return await parseMethod(val);
    } catch (err: any) {
      if (err instanceof ValidationError) throw err;
      if (err instanceof ZodError) {
        const details = formatZodIssues(err.issues as Array<{ path: (string | number)[]; message: string; code: string }>);
        throw new ValidationError('Validation failed', details);
      }
      throw err;
    }
  }

  return val;
}

/**
 * RouteRegistry handles controller registration, route resolution, and parameter injection.
 */
export class RouteRegistry {
  private routes: RouteDefinition[] = [];

  /**
   * Register a controller class or instance
   */
  public registerController(controller: any): void {
    const isConstructor = typeof controller === 'function';
    const instance = isConstructor ? new controller() : controller;
    const constructorFunc = isConstructor ? controller : controller.constructor;
    const proto = isConstructor ? controller.prototype : Object.getPrototypeOf(controller);

    const controllerMeta: ControllerMetadata =
      constructorFunc?.[CONTROLLER_METADATA_KEY] ||
      proto?.[CONTROLLER_METADATA_KEY] ||
      { prefix: '' };

    const routesMeta: MethodRouteMetadata[] =
      proto?.[ROUTE_METADATA_KEY] ||
      constructorFunc?.[ROUTE_METADATA_KEY] ||
      [];

    const paramsMap: Map<string | symbol, ParamMetadata[]> =
      proto?.[PARAM_METADATA_KEY] ||
      constructorFunc?.[PARAM_METADATA_KEY] ||
      new Map();

    for (const routeMeta of routesMeta) {
      const fullPath = combinePaths(controllerMeta.prefix, routeMeta.path);
      const { regex, paramNames } = pathToRegex(fullPath);

      const rawParamMeta = paramsMap.get(routeMeta.propertyKey) || [];
      const paramMetadata = [...rawParamMeta].sort((a, b) => a.index - b.index);

      const handler = instance[routeMeta.propertyKey];
      if (typeof handler !== 'function') {
        continue;
      }

      this.routes.push({
        httpMethod: routeMeta.httpMethod,
        path: routeMeta.path,
        fullPath,
        propertyKey: routeMeta.propertyKey,
        handler,
        instance,
        paramMetadata,
        regex,
        paramNames
      });
    }
  }

  /**
   * Alias for registerController
   */
  public register(controller: any): void {
    this.registerController(controller);
  }

  /**
   * Get all registered route definitions
   */
  public getRoutes(): RouteDefinition[] {
    return [...this.routes];
  }

  /**
   * Clear all registered routes
   */
  public clear(): void {
    this.routes = [];
  }

  /**
   * Match an incoming HTTP method and path against registered routes
   */
  public match(method: string, path: string): RouteMatch | null {
    const upperMethod = (method || 'GET').toUpperCase();
    const cleanPath = normalizePath(path.split('?')[0]);

    for (const route of this.routes) {
      if (route.httpMethod !== upperMethod && route.httpMethod !== 'ALL') {
        continue;
      }

      const match = route.regex.exec(cleanPath);
      if (match) {
        const params: Record<string, string> = {};
        for (let i = 0; i < route.paramNames.length; i++) {
          const paramName = route.paramNames[i];
          const rawVal = match[i + 1];
          params[paramName] = rawVal !== undefined ? decodeURIComponent(rawVal) : rawVal;
        }
        return {
          route,
          params,
          handler: route.handler,
          instance: route.instance
        };
      }
    }

    return null;
  }

  /**
   * Dispatch request to matching route handler with parameter injection
   */
  public async dispatch(method: string, path: string, req: RequestContext = {}): Promise<any> {
    const upperMethod = (method || 'GET').toUpperCase();
    const cleanPath = normalizePath(path.split('?')[0]);

    const routeMatch = this.match(upperMethod, cleanPath);
    if (!routeMatch) {
      throw new Error(`Route not found: ${upperMethod} ${cleanPath}`);
    }

    try {
      // Merge extracted path params into request context
      const mergedReq: RequestContext = {
        ...req,
        method: upperMethod,
        path: cleanPath,
        params: { ...routeMatch.params, ...(req.params || {}) }
      };

      // Extract query string if url provided and query not fully set
      const rawUrl = req.url || path;
      if (rawUrl.includes('?')) {
        const queryString = rawUrl.split('?')[1];
        if (queryString) {
          const urlQueryParams: Record<string, string> = {};
          const searchParams = new URLSearchParams(queryString);
          searchParams.forEach((val, key) => {
            urlQueryParams[key] = val;
          });
          mergedReq.query = { ...urlQueryParams, ...(req.query || {}) };
        }
      }

      const { paramMetadata, handler, instance } = routeMatch.route;
      let args: any[];

      if (paramMetadata && paramMetadata.length > 0) {
        const maxIndex = Math.max(...paramMetadata.map((p) => p.index));
        args = new Array(maxIndex + 1);
        for (const pm of paramMetadata) {
          args[pm.index] = await extractParamValue(pm, mergedReq);
        }
      } else {
        args = [mergedReq];
      }

      return await handler.apply(instance, args);
    } catch (err: any) {
      const reqId = req.id || req.frameId || req.requestId;
      const reqMeta = req.metadata || req.headers;

      if (err instanceof ValidationError) {
        return createErrorTupleFrame(400, err.message, err.details, reqId, reqMeta);
      }

      if (err instanceof ZodError) {
        const details = formatZodIssues(err.issues as Array<{ path: (string | number)[]; message: string; code: string }>);
        return createErrorTupleFrame(400, 'Validation failed', details, reqId, reqMeta);
      }

      if (err instanceof HttpError) {
        return createErrorTupleFrame(err.statusCode, err.message, err.details, reqId, reqMeta);
      }

      const code = typeof err?.statusCode === 'number' ? err.statusCode : typeof err?.status === 'number' ? err.status : 500;
      const message = err?.message || 'Internal Server Error';
      const details = Array.isArray(err?.details) ? err.details : undefined;

      return createErrorTupleFrame(code, message, details, reqId, reqMeta);
    }
  }

  /**
   * Convenience handler for processing a RequestContext
   */
  public async handle(req: RequestContext): Promise<any> {
    const method = req.method || 'GET';
    const path = req.path || req.url || '/';
    return this.dispatch(method, path, req);
  }
}
