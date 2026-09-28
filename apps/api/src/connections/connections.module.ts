import { Module } from '@nestjs/common';
import { ConnectionsService } from './connections.service';
import { ConnectionsController, GithubCallbackController } from './connections.controller';

@Module({
  controllers: [ConnectionsController, GithubCallbackController],
  providers: [ConnectionsService],
  exports: [ConnectionsService],
})
export class ConnectionsModule {}
