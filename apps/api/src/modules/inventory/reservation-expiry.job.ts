import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { APP_ENV, type Env } from '../../config/env';
import { JobsService } from '../jobs/jobs.service';
import { ReservationsService } from './reservations.service';

export const RESERVATION_QUEUE = 'reservation-expiry';
const SWEEP_EVERY_MS = 60_000;

/**
 * Releases reservations whose time has run out (D4-15). A repeating job on the `reservation-expiry`
 * queue calls `ReservationsService.expireDue`; it is safe to run from several API instances
 * because each hold changes state once. Without Redis the API still starts, and holds simply wait
 * for the next sweep (confirming an expired hold is refused either way). Tests start it explicitly.
 */
@Injectable()
export class ReservationExpiryJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReservationExpiryJob.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly reservations: ReservationsService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.env.NODE_ENV === 'test') return;
    if (!this.jobs.enabled) {
      this.logger.warn('REDIS_URL is not set: reservation expiry is not running.');
      return;
    }
    await this.start();
  }

  /** Registers the repeating sweep and the worker that runs it. */
  async start(everyMs = SWEEP_EVERY_MS): Promise<void> {
    await this.jobs
      .queue(RESERVATION_QUEUE)
      .upsertJobScheduler('sweep', { every: everyMs }, { name: 'sweep' });
    this.jobs.worker(RESERVATION_QUEUE, async () => {
      const freed = await this.reservations.expireDue();
      if (freed > 0) this.logger.log(`Released ${freed} expired reservation(s).`);
      return freed;
    });
  }
}
