import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { encodeFrame } from '@bxios/wire';
import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Query,
  Param,
  Headers,
  RouteRegistry,
  ValidationError,
  HttpError,
  isErrorTupleFrame,
  createErrorTupleFrame
} from '../src/index.js';

describe('Zod Validation & Error Handler Middleware', () => {
  let registry: RouteRegistry;

  const UserSchema = z.object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    email: z.string().email('Invalid email address'),
    age: z.number().min(18, 'Must be at least 18 years old')
  });

  const FilterSchema = z.object({
    page: z.coerce.number().min(1, 'Page must be at least 1'),
    limit: z.coerce.number().max(100, 'Limit cannot exceed 100').default(10)
  });

  const ParamSchema = z.object({
    id: z.string().uuid('ID must be a valid UUID')
  });

  const AsyncSchema = z.string().refine(async (value) => value === 'allowed', 'Value is not allowed');
  const AsyncOperationalSchema = z.string().refine(async () => {
    throw new Error('Async refinement service unavailable');
  });

  @Controller('/api/v1')
  class TestController {
    @Post('/users')
    createUser(@Body(UserSchema) body: z.infer<typeof UserSchema>) {
      return { success: true, user: body };
    }

    @Post('/users/keyed')
    createUserKeyed(@Body('profile', UserSchema) profile: z.infer<typeof UserSchema>) {
      return { success: true, profile };
    }

    @Get('/products')
    getProducts(@Query(FilterSchema) query: z.infer<typeof FilterSchema>) {
      return { success: true, query };
    }

    @Get('/users/:id')
    getUserById(@Param(ParamSchema) params: z.infer<typeof ParamSchema>) {
      return { success: true, id: params.id };
    }

    @Get('/users/by-id/:id')
    getUserByIdKeyed(@Param('id', z.string().uuid('Must be UUID')) id: string) {
      return { success: true, id };
    }

    @Get('/secure')
    secureRoute(@Headers('x-api-key', z.string().min(10, 'API key too short')) apiKey: string) {
      return { success: true, apiKey };
    }

    @Post('/async-validation')
    asyncValidation(@Body(AsyncSchema) value: string) {
      return { success: true, value };
    }

    @Post('/async-operational-failure')
    asyncOperationalFailure(@Body(AsyncOperationalSchema) value: string) {
      return { success: true, value };
    }

    @Get('/sync-fail')
    syncFail() {
      throw new Error('Database connection failed');
    }

    @Get('/async-fail')
    async asyncFail() {
      await new Promise((r) => setTimeout(r, 10));
      throw new Error('Unhandled async service failure');
    }

    @Get('/custom-http-fail')
    customFail() {
      throw new HttpError(403, 'Access forbidden to resource');
    }
  }

  beforeEach(() => {
    registry = new RouteRegistry();
    registry.registerController(TestController);
  });

  describe('Valid Zod Schemas & Argument Injection', () => {
    it('injects valid and coerced body data into route handler', async () => {
      const validPayload = {
        name: 'Jane Doe',
        email: 'jane@example.com',
        age: 25
      };

      const res = await registry.dispatch('POST', '/api/v1/users', {
        body: validPayload
      });

      expect(res).toEqual({
        success: true,
        user: validPayload
      });
    });

    it('handles keyed @Body with valid schema', async () => {
      const profileData = {
        name: 'Alice',
        email: 'alice@example.com',
        age: 30
      };

      const res = await registry.dispatch('POST', '/api/v1/users/keyed', {
        body: { profile: profileData }
      });

      expect(res).toEqual({
        success: true,
        profile: profileData
      });
    });

    it('coerces and injects valid @Query schema data', async () => {
      const res = await registry.dispatch('GET', '/api/v1/products', {
        query: { page: '2', limit: '20' }
      });

      expect(res).toEqual({
        success: true,
        query: { page: 2, limit: 20 }
      });
    });

    it('validates @Param schema for route params', async () => {
      const validUuid = '123e4567-e89b-12d3-a456-426614174000';
      const res = await registry.dispatch('GET', `/api/v1/users/${validUuid}`);

      expect(res).toEqual({
        success: true,
        id: validUuid
      });
    });

    it('validates header schema', async () => {
      const res = await registry.dispatch('GET', '/api/v1/secure', {
        headers: { 'x-api-key': 'super-secret-api-key-12345' }
      });

      expect(res).toEqual({
        success: true,
        apiKey: 'super-secret-api-key-12345'
      });
    });

    it('accepts a value when an async Zod refinement succeeds', async () => {
      const res = await registry.dispatch('POST', '/api/v1/async-validation', {
        body: 'allowed'
      });

      expect(res).toEqual({ success: true, value: 'allowed' });
    });
  });

  describe('Validation Failures & 400 Bad Request Tuple Frames', () => {
    it('returns a 400 Bad Request tuple frame with field details on invalid body', async () => {
      const res = await registry.dispatch('POST', '/api/v1/users', {
        id: 'req-400-test',
        body: {
          name: 'J', // too short
          email: 'not-an-email', // invalid email
          age: 15 // under 18
        }
      });

      expect(isErrorTupleFrame(res)).toBe(true);
      expect(res.code).toBe(400);
      expect(res.id).toBe('req-400-test');
      expect(res.payload.statusCode).toBe(400);
      expect(res.payload.error).toBe('Bad Request');
      expect(res.payload.message).toBe('Validation failed');
      expect(res.payload.details).toBeDefined();
      expect(res.payload.details?.length).toBe(3);

      const fields = res.payload.details?.map((d) => d.field);
      expect(fields).toContain('name');
      expect(fields).toContain('email');
      expect(fields).toContain('age');

      // Verify rawTuple array structure
      expect(Array.isArray(res.rawTuple)).toBe(true);
      expect(res.rawTuple.length).toBe(6);
      expect(res.rawTuple[0]).toBe(0); // FrameType.Unary
      expect(res.rawTuple[1]).toBe('req-400-test'); // id
      expect(res.rawTuple[5]).toBe(400); // code

      // Verify @bxios/wire encodeFrame compatibility
      const encoded = encodeFrame(res);
      expect(encoded).toBeInstanceOf(Uint8Array);
      expect(encoded.length).toBeGreaterThan(0);
    });

    it('returns 400 tuple frame on invalid path param', async () => {
      const res = await registry.dispatch('GET', '/api/v1/users/invalid-uuid-123');

      expect(isErrorTupleFrame(res)).toBe(true);
      expect(res.code).toBe(400);
      expect(res.payload.statusCode).toBe(400);
      expect(res.payload.details?.[0].field).toBe('id');
      expect(res.payload.details?.[0].message).toContain('ID must be a valid UUID');
    });

    it('returns 400 tuple frame on missing or invalid header', async () => {
      const res = await registry.dispatch('GET', '/api/v1/secure', {
        headers: { 'x-api-key': 'short' }
      });

      expect(isErrorTupleFrame(res)).toBe(true);
      expect(res.code).toBe(400);
      expect(res.payload.details?.[0].message).toContain('API key too short');
    });

    it('returns 400 tuple frame when an async Zod refinement fails', async () => {
      const res = await registry.dispatch('POST', '/api/v1/async-validation', {
        id: 'req-400-async',
        body: 'rejected'
      });

      expect(isErrorTupleFrame(res)).toBe(true);
      expect(res.code).toBe(400);
      expect(res.id).toBe('req-400-async');
      expect(res.payload.details?.[0].message).toContain('Value is not allowed');
    });

    it('returns a 500 tuple frame when an async refinement rejects operationally', async () => {
      const res = await registry.dispatch('POST', '/api/v1/async-operational-failure', {
        id: 'req-500-async-refinement',
        body: 'allowed'
      });

      expect(isErrorTupleFrame(res)).toBe(true);
      expect(res.code).toBe(500);
      expect(res.id).toBe('req-500-async-refinement');
      expect(res.payload.statusCode).toBe(500);
      expect(res.payload.error).toBe('Internal Server Error');
      expect(res.payload.message).toBe('Async refinement service unavailable');
    });
  });

  describe('Uncaught Exception Catching & 500 Status Tuple Frames', () => {
    it('catches synchronous route exceptions and formats into standard 500 status tuple frame', async () => {
      const res = await registry.dispatch('GET', '/api/v1/sync-fail', {
        id: 'req-500-sync'
      });

      expect(isErrorTupleFrame(res)).toBe(true);
      expect(res.code).toBe(500);
      expect(res.id).toBe('req-500-sync');
      expect(res.payload.statusCode).toBe(500);
      expect(res.payload.error).toBe('Internal Server Error');
      expect(res.payload.message).toBe('Database connection failed');

      // Verify wire encoding compatibility
      const encoded = encodeFrame(res);
      expect(encoded).toBeInstanceOf(Uint8Array);
    });

    it('catches asynchronous route rejections and formats into standard 500 status tuple frame', async () => {
      const res = await registry.dispatch('GET', '/api/v1/async-fail', {
        id: 'req-500-async'
      });

      expect(isErrorTupleFrame(res)).toBe(true);
      expect(res.code).toBe(500);
      expect(res.id).toBe('req-500-async');
      expect(res.payload.statusCode).toBe(500);
      expect(res.payload.error).toBe('Internal Server Error');
      expect(res.payload.message).toBe('Unhandled async service failure');
    });

    it('formats HttpError exceptions with custom status codes (e.g., 403 Forbidden)', async () => {
      const res = await registry.dispatch('GET', '/api/v1/custom-http-fail');

      expect(isErrorTupleFrame(res)).toBe(true);
      expect(res.code).toBe(403);
      expect(res.payload.statusCode).toBe(403);
      expect(res.payload.error).toBe('Forbidden');
      expect(res.payload.message).toBe('Access forbidden to resource');
    });
  });

  describe('Standalone Helper Utilities', () => {
    it('createErrorTupleFrame creates valid wire FrameTuple objects', () => {
      const frame = createErrorTupleFrame(
        400,
        'Bad Request',
        [{ field: 'username', path: ['username'], message: 'Required', code: 'invalid_type' }],
        'custom-id'
      );

      expect(frame.type).toBe(0);
      expect(frame.id).toBe('custom-id');
      expect(frame.code).toBe(400);
      expect(frame.payload.statusCode).toBe(400);

      const encoded = encodeFrame(frame);
      expect(encoded).toBeInstanceOf(Uint8Array);
    });
  });
});
