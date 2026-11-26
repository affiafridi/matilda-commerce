import { Global, Module } from '@nestjs/common';
import { JobsService } from './jobs.service';

/** Global so any module can enqueue work without importing wiring. */
@Global()
@Module({ providers: [JobsService], exports: [JobsService] })
export class JobsModule {}
