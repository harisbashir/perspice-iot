import { Global, Module } from '@nestjs/common';
import { AlarmRulesController } from './rules.controller';
import { AlarmRulesService } from './rules.service';

@Global()
@Module({
  controllers: [AlarmRulesController],
  providers: [AlarmRulesService],
  exports: [AlarmRulesService],
})
export class AlarmsModule {}
