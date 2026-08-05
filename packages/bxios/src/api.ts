import { InterceptorManager } from './interceptors.js';
import type {
  AxiosLikeError,
  AxiosRequestConfig,
  AxiosResponse,
} from './types.js';

export function createCanceledError(reason?: any, config?: Record<string, any>): AxiosLikeError {
  const message = typeof reason === 'string' ? reason : reason?.message || 'canceled';
  const err = new Error(message) as AxiosLikeError;
  err.name = 'CanceledError';
  err.code = 'ERR_CANCELED';
  err.config = config ?? {};
  err.isAxiosError = true;
  err.statusCode = 0;
  return err;
}

export class Bxios {
  public defaults: AxiosRequestConfig;
  public interceptors = {
    request: new InterceptorManager<AxiosRequestConfig>(),
    response: new InterceptorManager<AxiosResponse>(),
  };

  constructor(defaults?: AxiosRequestConfig) {
    this.defaults = defaults ?? {};
  }

  public dispatchRequest<T = any, D = any>(config: AxiosRequestConfig<D>): Promise<AxiosResponse<T, D>> {
    if (config.signal) {
      if (config.signal.aborted) {
        return Promise.reject(createCanceledError(config.signal.reason, config));
      }
    }

    if (typeof config.adapter === 'function') {
      if (config.signal) {
        return new Promise<AxiosResponse<T, D>>((resolve, reject) => {
          const onAbort = () => {
            reject(createCanceledError(config.signal?.reason, config));
          };

          config.signal?.addEventListener('abort', onAbort);

          config.adapter!(config)
            .then((res) => {
              config.signal?.removeEventListener('abort', onAbort);
              resolve(res);
            })
            .catch((err) => {
              config.signal?.removeEventListener('abort', onAbort);
              reject(err);
            });
        });
      }
      return config.adapter(config);
    }

    // Default adapter fallback
    const defaultResponse: AxiosResponse<T, D> = {
      data: (config.data ?? null) as unknown as T,
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };

    if (config.signal) {
      return new Promise<AxiosResponse<T, D>>((resolve, reject) => {
        const onAbort = () => {
          reject(createCanceledError(config.signal?.reason, config));
        };

        config.signal?.addEventListener('abort', onAbort);

        setTimeout(() => {
          if (config.signal?.aborted) {
            reject(createCanceledError(config.signal.reason, config));
          } else {
            config.signal?.removeEventListener('abort', onAbort);
            resolve(defaultResponse);
          }
        }, 0);
      });
    }

    return Promise.resolve(defaultResponse);
  }

  public request<T = any, R = AxiosResponse<T>, D = any>(
    configOrUrl: string | AxiosRequestConfig<D>,
    config?: AxiosRequestConfig<D>
  ): Promise<R> {
    let requestConfig: AxiosRequestConfig<D>;
    if (typeof configOrUrl === 'string') {
      requestConfig = { ...config, url: configOrUrl };
    } else {
      requestConfig = { ...configOrUrl };
    }

    requestConfig = this.mergeConfig(this.defaults, requestConfig);

    // Chain construction
    const chain: Array<{
      fulfilled?: (value: any) => any;
      rejected?: (error: any) => any;
    }> = [
      {
        fulfilled: (cfg: AxiosRequestConfig<D>) => this.dispatchRequest<T, D>(cfg),
        rejected: undefined,
      },
    ];

    // Request interceptors run in unshift order
    this.interceptors.request.forEach((interceptor) => {
      chain.unshift({
        fulfilled: interceptor.fulfilled,
        rejected: interceptor.rejected,
      });
    });

    // Response interceptors run in push order
    this.interceptors.response.forEach((interceptor) => {
      chain.push({
        fulfilled: interceptor.fulfilled,
        rejected: interceptor.rejected,
      });
    });

    let promise: Promise<any> = Promise.resolve(requestConfig);

    while (chain.length) {
      const { fulfilled, rejected } = chain.shift()!;
      promise = promise.then(fulfilled, rejected);
    }

    return promise as Promise<R>;
  }

  public get<T = any, R = AxiosResponse<T>, D = any>(
    url: string,
    config?: AxiosRequestConfig<D>
  ): Promise<R> {
    return this.request<T, R, D>({ ...config, method: 'GET', url });
  }

  public delete<T = any, R = AxiosResponse<T>, D = any>(
    url: string,
    config?: AxiosRequestConfig<D>
  ): Promise<R> {
    return this.request<T, R, D>({ ...config, method: 'DELETE', url });
  }

  public head<T = any, R = AxiosResponse<T>, D = any>(
    url: string,
    config?: AxiosRequestConfig<D>
  ): Promise<R> {
    return this.request<T, R, D>({ ...config, method: 'HEAD', url });
  }

  public options<T = any, R = AxiosResponse<T>, D = any>(
    url: string,
    config?: AxiosRequestConfig<D>
  ): Promise<R> {
    return this.request<T, R, D>({ ...config, method: 'OPTIONS', url });
  }

  public post<T = any, R = AxiosResponse<T>, D = any>(
    url: string,
    data?: D,
    config?: AxiosRequestConfig<D>
  ): Promise<R> {
    return this.request<T, R, D>({ ...config, method: 'POST', url, data });
  }

  public put<T = any, R = AxiosResponse<T>, D = any>(
    url: string,
    data?: D,
    config?: AxiosRequestConfig<D>
  ): Promise<R> {
    return this.request<T, R, D>({ ...config, method: 'PUT', url, data });
  }

  public patch<T = any, R = AxiosResponse<T>, D = any>(
    url: string,
    data?: D,
    config?: AxiosRequestConfig<D>
  ): Promise<R> {
    return this.request<T, R, D>({ ...config, method: 'PATCH', url, data });
  }

  private mergeConfig(defaultConfig: AxiosRequestConfig, instanceConfig: AxiosRequestConfig): AxiosRequestConfig {
    return {
      ...defaultConfig,
      ...instanceConfig,
      headers: {
        ...(defaultConfig.headers ?? {}),
        ...(instanceConfig.headers ?? {}),
      },
    };
  }
}

export type BxiosInstance = Bxios & {
  <T = any, R = AxiosResponse<T>, D = any>(config: AxiosRequestConfig<D>): Promise<R>;
  <T = any, R = AxiosResponse<T>, D = any>(url: string, config?: AxiosRequestConfig<D>): Promise<R>;
  create(defaults?: AxiosRequestConfig): BxiosInstance;
};

export function createInstance(defaults?: AxiosRequestConfig): BxiosInstance {
  const context = new Bxios(defaults);

  const instance = function (configOrUrl: any, config?: any) {
    return context.request(configOrUrl, config);
  } as BxiosInstance;

  // Bind methods to instance
  instance.request = context.request.bind(context);
  instance.get = context.get.bind(context);
  instance.delete = context.delete.bind(context);
  instance.head = context.head.bind(context);
  instance.options = context.options.bind(context);
  instance.post = context.post.bind(context);
  instance.put = context.put.bind(context);
  instance.patch = context.patch.bind(context);
  instance.dispatchRequest = context.dispatchRequest.bind(context);
  instance.defaults = context.defaults;
  instance.interceptors = context.interceptors;

  instance.create = function (instanceDefaults?: AxiosRequestConfig) {
    return createInstance({ ...defaults, ...instanceDefaults });
  };

  return instance;
}

export const bxios = createInstance();
