import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Global so no feature module has to remember to import it. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
