import { describe, it, expect, beforeEach } from 'vitest';
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  Query,
  Param,
  Headers,
  Context,
  RouteRegistry,
  combinePaths,
  normalizePath,
  pathToRegex
} from '../src/index.js';

describe('Decorator Router & Parameter Injection', () => {
  let registry: RouteRegistry;

  beforeEach(() => {
    registry = new RouteRegistry();
  });

  describe('Path Utilities', () => {
    it('normalizes paths correctly', () => {
      expect(normalizePath('')).toBe('/');
      expect(normalizePath('users')).toBe('/users');
      expect(normalizePath('/users/')).toBe('/users');
      expect(normalizePath('//users///123//')).toBe('/users/123');
    });

    it('combines controller prefix and route paths', () => {
      expect(combinePaths('/api/v1', '/users')).toBe('/api/v1/users');
      expect(combinePaths('api', 'users')).toBe('/api/users');
      expect(combinePaths('/', '/users')).toBe('/users');
      expect(combinePaths('/api', '/')).toBe('/api');
      expect(combinePaths('', '')).toBe('/');
    });

    it('converts path patterns to regex with param extraction', () => {
      const { regex, paramNames } = pathToRegex('/users/:id/posts/:postId');
      expect(paramNames).toEqual(['id', 'postId']);
      expect(regex.test('/users/42/posts/99')).toBe(true);

      const match = regex.exec('/users/42/posts/99');
      expect(match?.[1]).toBe('42');
      expect(match?.[2]).toBe('99');
    });
  });

  describe('HTTP Decorators & Controller Registration', () => {
    @Controller('/users')
    class UserController {
      @Get('/')
      getAll() {
        return { action: 'getAll' };
      }

      @Get('/:id')
      getOne() {
        return { action: 'getOne' };
      }

      @Post('/')
      create() {
        return { action: 'create' };
      }

      @Put('/:id')
      update() {
        return { action: 'update' };
      }

      @Delete('/:id')
      delete() {
        return { action: 'delete' };
      }

      @Patch('/:id')
      patch() {
        return { action: 'patch' };
      }
    }

    it('registers controller class and extracts route definitions', () => {
      registry.registerController(UserController);
      const routes = registry.getRoutes();
      expect(routes.length).toBe(6);

      const paths = routes.map((r) => `${r.httpMethod} ${r.fullPath}`);
      expect(paths).toContain('GET /users');
      expect(paths).toContain('GET /users/:id');
      expect(paths).toContain('POST /users');
      expect(paths).toContain('PUT /users/:id');
      expect(paths).toContain('DELETE /users/:id');
      expect(paths).toContain('PATCH /users/:id');
    });

    it('registers controller instance directly', () => {
      const instance = new UserController();
      registry.register(instance);
      const routes = registry.getRoutes();
      expect(routes.length).toBe(6);
    });

    it('matches HTTP routes correctly', () => {
      registry.registerController(UserController);

      const matchGet = registry.match('GET', '/users/123');
      expect(matchGet).not.toBeNull();
      expect(matchGet?.route.fullPath).toBe('/users/:id');
      expect(matchGet?.params).toEqual({ id: '123' });

      const matchPost = registry.match('post', '/users');
      expect(matchPost).not.toBeNull();
      expect(matchPost?.route.httpMethod).toBe('POST');
    });
  });

  describe('Parameter Decorators & Injection', () => {
    @Controller('/api')
    class ApiController {
      @Get('/search/:category')
      search(
        @Param('category') cat: string,
        @Query('q') query: string,
        @Headers('authorization') auth: string
      ) {
        return { cat, query, auth };
      }

      @Post('/submit')
      submit(@Body() body: any, @Body('title') title: string, @Context() ctx: any) {
        return { body, title, ctx };
      }

      @Put('/items/:id')
      update(
        @Param() allParams: any,
        @Query() allQueries: any,
        @Headers() allHeaders: any,
        @Context('connId') connId: string
      ) {
        return { allParams, allQueries, allHeaders, connId };
      }

      @Get('/raw')
      rawHandler(req: any) {
        return { raw: req };
      }
    }

    beforeEach(() => {
      registry.registerController(ApiController);
    });

    it('injects @Param, @Query, and @Headers (with case-insensitivity)', async () => {
      const res = await registry.dispatch('GET', '/api/search/electronics', {
        query: { q: 'laptop' },
        headers: { Authorization: 'Bearer token123' }
      });

      expect(res).toEqual({
        cat: 'electronics',
        query: 'laptop',
        auth: 'Bearer token123'
      });
    });

    it('injects @Body and @Context', async () => {
      const res = await registry.dispatch('POST', '/api/submit', {
        body: { title: 'Hello World', content: 'Lorem' },
        context: { requestId: 'req-999' }
      });

      expect(res).toEqual({
        body: { title: 'Hello World', content: 'Lorem' },
        title: 'Hello World',
        ctx: { requestId: 'req-999' }
      });
    });

    it('injects whole objects when key is omitted', async () => {
      const res = await registry.dispatch('PUT', '/api/items/item-42', {
        query: { active: 'true' },
        headers: { 'x-client': 'test' },
        context: { connId: 'conn-abc' }
      });

      expect(res.allParams).toEqual({ id: 'item-42' });
      expect(res.allQueries).toEqual({ active: 'true' });
      expect(res.allHeaders).toEqual({ 'x-client': 'test' });
      expect(res.connId).toBe('conn-abc');
    });

    it('passes raw RequestContext when method has no parameter decorators', async () => {
      const reqCtx = { method: 'GET', path: '/api/raw', body: { a: 1 } };
      const res = await registry.handle(reqCtx);
      expect(res.raw.path).toBe('/api/raw');
    });
  });

  describe('RouteRegistry Execution & Edge Cases', () => {
    @Controller('/shop')
    class ShopController {
      @Get('/products/:id')
      async getProduct(@Param('id') id: string) {
        return Promise.resolve({ productId: id, name: `Product ${id}` });
      }
    }

    beforeEach(() => {
      registry.registerController(ShopController);
    });

    it('parses URL query params inside handle() if query object is missing', async () => {
      const res = await registry.handle({
        method: 'GET',
        url: '/shop/products/789?ref=email&sale=true'
      });

      expect(res).toEqual({ productId: '789', name: 'Product 789' });
    });

    it('throws error when no matching route is found', async () => {
      await expect(registry.dispatch('GET', '/unknown')).rejects.toThrow('Route not found: GET /unknown');
    });

    it('clears registered routes', () => {
      registry.clear();
      expect(registry.getRoutes().length).toBe(0);
      expect(registry.match('GET', '/shop/products/1')).toBeNull();
    });
  });
});
