import { Controller, Get, type INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { notFound } from '../../src/common/app-error';
import { ProblemFilter } from '../../src/common/problem.filter';

@Controller('t')
class ThrowingController {
  @Get('not-found')
  nf() {
    throw notFound();
  }

  @Get('zod')
  zod() {
    z.object({ name: z.string() }).parse({});
  }

  @Get('plain')
  plain() {
    throw new Error('x');
  }

  @Get('http')
  http() {
    throw new NotFoundException();
  }
}

describe('ProblemFilter', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ controllers: [ThrowingController] }).compile();
    app = mod.createNestApplication({ logger: false });
    app.useGlobalFilters(new ProblemFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('maps AppError notFound to 404 NOT_FOUND', async () => {
    const res = await request(app.getHttpServer()).get('/t/not-found');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('maps ZodError to 400 VALIDATION with issues in details', async () => {
    const res = await request(app.getHttpServer()).get('/t/zod');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION');
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details[0].path).toEqual(['name']);
  });

  it('maps unknown errors to 500 without leaking the stack', async () => {
    const res = await request(app.getHttpServer()).get('/t/plain');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ code: 'INTERNAL', message: 'Internal error' });
  });

  it('maps Nest HttpException to the problem shape', async () => {
    const res = await request(app.getHttpServer()).get('/t/http');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});
