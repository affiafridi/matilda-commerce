import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { APP_ENV, type Env } from '../../config/env';
import { type MailMessage, MailPort } from './mail.port';

/**
 * Development/test adapter: nothing is sent. Full messages (including one-time links) are logged
 * only in development and test; elsewhere only metadata is logged, so links never reach shared logs.
 */
@Injectable()
export class ConsoleMailAdapter extends MailPort {
  /** Captured messages, for tests. */
  readonly outbox: MailMessage[] = [];

  constructor(
    private readonly logger: PinoLogger,
    @Inject(APP_ENV) private readonly env: Env,
  ) {
    super();
    this.logger.setContext(ConsoleMailAdapter.name);
  }

  send(message: MailMessage): Promise<void> {
    this.outbox.push(message);
    if (this.env.NODE_ENV === 'development' || this.env.NODE_ENV === 'test') {
      this.logger.info({ mail: message }, 'Mail (console adapter, not sent)');
    } else {
      this.logger.warn(
        { template: message.template },
        'No mail provider configured; message was not sent',
      );
    }
    return Promise.resolve();
  }
}
