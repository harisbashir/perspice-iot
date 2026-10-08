import { type DynamicModule, Global, Module } from '@nestjs/common';
import { CommandTimeoutJob } from './command-timeout.job';
import { CommandsController } from './commands.controller';
import { CommandsListener } from './commands.listener';
import { CommandsPublisher } from './commands.publisher';
import { CommandsService } from './commands.service';

@Global()
@Module({})
export class CommandsModule {
  static forRoot(opts: { api: boolean; scheduler: boolean }): DynamicModule {
    return {
      module: CommandsModule,
      controllers: opts.api ? [CommandsController] : [],
      providers: [
        CommandsService,
        CommandsPublisher,
        CommandTimeoutJob,
        { provide: 'SCHEDULE_COMMAND_JOBS', useValue: opts.scheduler },
        ...(opts.api ? [CommandsListener] : []),
      ],
      exports: [CommandsService, CommandsPublisher, CommandTimeoutJob],
    };
  }
}
