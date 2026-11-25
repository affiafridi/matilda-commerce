import { Injectable } from '@nestjs/common';
import { generateSecret, generateURI, verifySync } from 'otplib';
import * as QRCode from 'qrcode';

const ISSUER = 'Matilda Commerce';
const CODE_FORMAT = /^\d{6}$/;
/** Accept the previous and next 30-second step to tolerate clock drift. */
const EPOCH_TOLERANCE_SECONDS = 30;

@Injectable()
export class TotpService {
  generateSecret(): string {
    return generateSecret();
  }

  otpauthUri(email: string, secret: string): string {
    return generateURI({ issuer: ISSUER, label: email, secret });
  }

  qrDataUrl(uri: string): Promise<string> {
    return QRCode.toDataURL(uri, { margin: 1, width: 220 });
  }

  /**
   * Verifies a 6-digit code. Returns the matched 30-second time step (for single-use enforcement
   * by the caller) or null when the code is wrong or malformed.
   */
  verify(secret: string, code: string): number | null {
    if (!CODE_FORMAT.test(code)) return null;
    const result = verifySync({ secret, token: code, epochTolerance: EPOCH_TOLERANCE_SECONDS });
    return result.valid && 'timeStep' in result ? result.timeStep : null;
  }
}
