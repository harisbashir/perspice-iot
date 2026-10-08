import { Global, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtGuard } from './jwt.guard';
import { LockoutService } from './lockout.service';
import { SessionService } from './session.service';
import { TenantHostMiddleware, TenantHostResolver } from './tenant-host.middleware';
import { TokenService } from './token.service';
import { TotpService } from './totp.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    LockoutService,
    TokenService,
    TotpService,
    TenantHostResolver,
    { provide: APP_GUARD, useClass: JwtGuard },
  ],
  exports: [AuthService, SessionService, TokenService, TenantHostResolver],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantHostMiddleware).forRoutes('*path');
  }
}
