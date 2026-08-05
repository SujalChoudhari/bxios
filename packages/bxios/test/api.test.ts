import { describe, it, expect, vi } from 'vitest';
import {
  bxios,
  createInstance,
  InterceptorManager,
  createCanceledError,
  AxiosRequestConfig,
  AxiosResponse,
} from '../src/index.js';

describe('Axios-compatible Method Suite & Interceptors', () => {
  describe('Acceptance Criteria 1: Expose bxios.get(), bxios.post(), etc., wrapping dispatchRequest', () => {
    it('provides HTTP verb helper methods (get, post, put, delete, patch, head, options)', async () => {
      const adapter = vi.fn(async (config: AxiosRequestConfig): Promise<AxiosResponse> => {
        return {
          data: { echoedMethod: config.method, echoedUrl: config.url, payload: config.data },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        };
      });

      const instance = createInstance({ adapter });

      const getRes = await instance.get('/api/users');
      expect(adapter).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', url: '/api/users' }));
      expect(getRes.data.echoedMethod).toBe('GET');

      const postRes = await instance.post('/api/users', { name: 'Alice' });
      expect(adapter).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', url: '/api/users', data: { name: 'Alice' } }));
      expect(postRes.data.payload).toEqual({ name: 'Alice' });

      const putRes = await instance.put('/api/users/1', { name: 'Bob' });
      expect(putRes.data.echoedMethod).toBe('PUT');

      const delRes = await instance.delete('/api/users/1');
      expect(delRes.data.echoedMethod).toBe('DELETE');

      const patchRes = await instance.patch('/api/users/1', { name: 'Charlie' });
      expect(patchRes.data.echoedMethod).toBe('PATCH');

      const headRes = await instance.head('/api/health');
      expect(headRes.data.echoedMethod).toBe('HEAD');

      const optRes = await instance.options('/api/options');
      expect(optRes.data.echoedMethod).toBe('OPTIONS');
    });

    it('wraps dispatchRequest and allows custom instance creation via bxios.create()', async () => {
      const customAdapter = async (config: AxiosRequestConfig): Promise<AxiosResponse> => ({
        data: 'custom-response',
        status: 201,
        statusText: 'Created',
        headers: { 'x-custom': 'header' },
        config,
      });

      const client = bxios.create({ adapter: customAdapter });
      const res = await client.get('http://test.local');

      expect(res.status).toBe(201);
      expect(res.data).toBe('custom-response');
      expect(res.headers['x-custom']).toBe('header');
    });
  });

  describe('Acceptance Criteria 2: InterceptorManager supporting async use() and eject()', () => {
    it('supports registering, running, and ejecting request interceptors (async and sync)', async () => {
      const instance = createInstance({
        adapter: async (config) => ({
          data: config.headers,
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        }),
      });

      // Interceptor 1: Sync
      const id1 = instance.interceptors.request.use((config) => {
        config.headers = { ...config.headers, 'x-step-1': 'true' };
        return config;
      });

      // Interceptor 2: Async
      const id2 = instance.interceptors.request.use(async (config) => {
        await new Promise((res) => setTimeout(res, 10));
        config.headers = { ...config.headers, 'x-step-2': 'async-ok' };
        return config;
      });

      let res = await instance.get('/test');
      expect(res.data['x-step-1']).toBe('true');
      expect(res.data['x-step-2']).toBe('async-ok');

      // Eject interceptor 1
      instance.interceptors.request.eject(id1);

      res = await instance.get('/test');
      expect(res.data['x-step-1']).toBeUndefined();
      expect(res.data['x-step-2']).toBe('async-ok');
    });

    it('supports registering, running, and ejecting response interceptors (async and sync)', async () => {
      const instance = createInstance({
        adapter: async (config) => ({
          data: { raw: 'value' },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        }),
      });

      const id = instance.interceptors.response.use(async (res) => {
        await new Promise((r) => setTimeout(r, 5));
        return {
          ...res,
          data: { ...res.data, intercepted: true },
        };
      });

      let res = await instance.get('/data');
      expect(res.data.intercepted).toBe(true);

      instance.interceptors.response.eject(id);
      res = await instance.get('/data');
      expect(res.data.intercepted).toBeUndefined();
    });

    it('handles rejected interceptor promises correctly in chain', async () => {
      const instance = createInstance();

      instance.interceptors.request.use(async () => {
        throw new Error('Request Interceptor Error');
      });

      await expect(instance.get('/fail')).rejects.toThrow('Request Interceptor Error');
    });
  });

  describe('Acceptance Criteria 3: AbortSignal integration for request cancellation', () => {
    it('immediately rejects if AbortSignal is already in aborted state', async () => {
      const controller = new AbortController();
      controller.abort('Pre-aborted request');

      const promise = bxios.get('/api/data', { signal: controller.signal });

      await expect(promise).rejects.toThrow('Pre-aborted request');
      try {
        await bxios.get('/api/data', { signal: controller.signal });
      } catch (err: any) {
        expect(err.code).toBe('ERR_CANCELED');
        expect(err.name).toBe('CanceledError');
        expect(err.isAxiosError).toBe(true);
      }
    });

    it('cancels in-flight request when AbortSignal fires', async () => {
      const controller = new AbortController();

      const adapter = vi.fn(
        (config: AxiosRequestConfig) =>
          new Promise<AxiosResponse>((resolve) => {
            setTimeout(() => {
              resolve({
                data: 'done',
                status: 200,
                statusText: 'OK',
                headers: {},
                config,
              });
            }, 500);
          })
      );

      const instance = createInstance({ adapter });
      const requestPromise = instance.get('/long-running', { signal: controller.signal });

      // Trigger abort while request is in flight
      setTimeout(() => {
        controller.abort('User canceled download');
      }, 50);

      await expect(requestPromise).rejects.toThrow('User canceled download');
      try {
        await requestPromise;
      } catch (err: any) {
        expect(err.code).toBe('ERR_CANCELED');
        expect(err.name).toBe('CanceledError');
      }
    });
  });
});
