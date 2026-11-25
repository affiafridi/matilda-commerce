import { Global, Module } from '@nestjs/common';
import { ConsoleMailAdapter } from './console-mail.adapter';
import { MailPort } from './mail.port';

@Global()
@Module({
  providers: [ConsoleMailAdapter, { provide: MailPort, useExisting: ConsoleMailAdapter }],
  exports: [MailPort, ConsoleMailAdapter],
})
export class MailModule {}
