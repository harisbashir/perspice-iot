import { Global, Module } from '@nestjs/common';
import { ApiKeysController } from '../api-keys/api-keys.controller';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { CustomersController } from '../customers/customers.controller';
import { CustomersService } from '../customers/customers.service';
import { UsersController } from '../users/users.controller';
import { UsersService } from '../users/users.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { ScopeService } from './scope';

@Global()
@Module({
  controllers: [RolesController, CustomersController, UsersController, ApiKeysController],
  providers: [ScopeService, RolesService, CustomersService, UsersService, ApiKeysService],
  exports: [ScopeService, RolesService, CustomersService, UsersService],
})
export class RbacModule {}
