import sharp from 'sharp';
import { ApiException } from '../../../common/errors/api-exception';

export const VARIANT_WIDTHS = { THUMBNAIL: 320, MEDIUM: 800, LARGE: 1600 } as const;
export type VariantKind = keyof typeof VARIANT_WIDTHS;

const FORMATS = {
  jpeg: { contentType: 'image/jpeg', ext: 'jpg' },
  png: { contentType: 'image/png', ext: 'png' },
  webp: { contentType: 'image/webp', ext: 'webp' },
} as const;
type Format = keyof typeof FORMATS;

/** Largest accepted picture, in pixels (guards against decompression bombs). */
const MAX_PIXELS = 40_000_000;

export interface ProcessedImage {
  contentType: string;
  ext: string;
  width: number;
  height: number;
  original: Buffer;
  variants: { kind: VariantKind; width: number; height: number; data: Buffer }[];
}

/** The format the first bytes announce, regardless of what the client claimed. */
export function sniffFormat(data: Buffer): Format | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg';
  if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

const unsupported = () =>
  new ApiException(422, 'UNSUPPORTED_IMAGE', 'Upload a JPEG, PNG or WebP picture');

/**
 * Validates an upload by its content (not its name or declared type) and produces the sanitised
 * original and the WebP variants. Re-encoding drops metadata such as GPS location and neutralises
 * files that are valid images but carry extra payloads.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const claimed = sniffFormat(input);
  if (!claimed) throw unsupported();
  try {
    const source = sharp(input, { limitInputPixels: MAX_PIXELS, failOn: 'error' });
    const meta = await source.metadata();
    if (meta.format !== claimed || !meta.width || !meta.height) throw unsupported();
    const pipeline = () => sharp(input, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).rotate();
    const encoded =
      claimed === 'jpeg'
        ? pipeline().jpeg({ quality: 90, mozjpeg: true })
        : claimed === 'png'
          ? pipeline().png({ compressionLevel: 9 })
          : pipeline().webp({ quality: 90 });
    const original = await encoded.toBuffer({ resolveWithObject: true });
    const variants: ProcessedImage['variants'] = [];
    for (const [kind, width] of Object.entries(VARIANT_WIDTHS) as [VariantKind, number][]) {
      const out = await pipeline()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      variants.push({ kind, width: out.info.width, height: out.info.height, data: out.data });
    }
    return {
      contentType: FORMATS[claimed].contentType,
      ext: FORMATS[claimed].ext,
      width: original.info.width,
      height: original.info.height,
      original: original.data,
      variants,
    };
  } catch (err) {
    if (err instanceof ApiException) throw err;
    throw unsupported();
  }
}
