import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/** Argon2id with OWASP-recommended parameters (19 MiB, t=2, p=1). */
const ARGON2_OPTIONS = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  /** Verified against when the account does not exist, so timing does not reveal it. */
  private dummyHash: Promise<string> | null = null;

  hash(password: string): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return hash(password, ARGON2_OPTIONS as any);
  }

  async verify(passwordHash: string | null | undefined, password: string): Promise<boolean> {
    if (!passwordHash) {
      this.dummyHash ??= this.hash('dummy password for timing');
      await verify(await this.dummyHash, password).catch(() => false);
      return false;
    }
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }
}
