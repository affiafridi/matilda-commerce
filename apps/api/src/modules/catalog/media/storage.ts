import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Where media bytes live. The database stores only keys; the adapter decides how they are kept. */
export interface MediaStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE');

/** Development adapter: files under one private folder. Keys can never leave it. */
export class LocalMediaStorage implements MediaStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    const target = path.resolve(this.root, key);
    if (!target.startsWith(this.root + path.sep)) throw new Error('Invalid storage key');
    return target;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolve(key));
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}
