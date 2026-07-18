import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/all-exceptions.filter';
import { ResponseInterceptor } from './../src/common/response.interceptor';

describe('Public API (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/api/v1/public/client-config (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/v1/public/client-config')
      .expect(200)
      .expect((res) => {
        expect(res.body.code).toBe(0);
        expect(res.body.data).toHaveProperty('apiBase');
        expect(res.body.data).toHaveProperty('authWebBase');
      });
  });

  it('/api/v1/auth/sms/send rate-limit shape', () => {
    return request(app.getHttpServer())
      .post('/api/v1/auth/sms/send')
      .send({ phone: '13800139999' })
      .expect((res) => {
        expect([200, 201, 429]).toContain(res.status);
        expect(res.body).toHaveProperty('code');
      });
  });
});
