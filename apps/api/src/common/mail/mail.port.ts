export interface MailMessage {
  to: string;
  subject: string;
  /** Plain-text body. May contain one-time links; adapters must treat it as sensitive. */
  text: string;
  /** Used for audit/log correlation only (e.g. "staff.invite"). */
  template: string;
}

/**
 * Outbound email port. Real providers arrive with Notifications (Phase 6); until then only the
 * console adapter exists (docs/PHASE-2-PLAN.md D2-11).
 */
export abstract class MailPort {
  abstract send(message: MailMessage): Promise<void>;
}
