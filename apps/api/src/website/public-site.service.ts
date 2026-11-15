import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { DatabaseHandle } from '@school-erp/db';
import { withContext } from '@school-erp/db';
import { notFound } from '@school-erp/shared';
import type { PublicInquiryInput } from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import { API_CONFIG } from '../config/api-config.js';
import type { ApiConfig } from '../config/api-config.js';
import { FixedWindowLimiter } from '../common/rate-limiter.js';
import type { ClientInfo } from '../auth/decorators.js';

const MINUTE = 60_000;

export interface PublicSite {
  name: string;
  slug: string;
  campuses: Array<{
    id: string;
    name: string;
    board: string;
    address: string | null;
    phone: string | null;
    email: string | null;
  }>;
  pages: Array<{ slug: string; title: string }>;
}

/**
 * Anonymous access to a school's public website. Everything goes through the
 * app.public_* definer functions, which only expose published pages of active schools.
 */
@Injectable()
export class PublicSiteService {
  private readonly limiter: FixedWindowLimiter;

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    @Inject(API_CONFIG) config: ApiConfig,
  ) {
    this.limiter = new FixedWindowLimiter(config.NODE_ENV === 'test' ? 50 : 1);
  }

  async site(slug: string, client: ClientInfo): Promise<PublicSite> {
    const row = await withContext(
      this.handle.db,
      { requestId: client.requestId },
      (tx) => tx.execute<{ site: PublicSite | null }>(sql`select app.public_site(${slug}) as site`),
      { readOnly: true },
    );
    const site = row.rows[0]?.site;
    if (!site) throw notFound('School');
    return site;
  }

  async page(slug: string, page: string, client: ClientInfo) {
    const row = await withContext(
      this.handle.db,
      { requestId: client.requestId },
      (tx) =>
        tx.execute<{ page: { title: string; body: string; publishedAt: string } | null }>(
          sql`select app.public_page(${slug}, ${page}) as page`,
        ),
      { readOnly: true },
    );
    const result = row.rows[0]?.page;
    if (!result) throw notFound('Page');
    return result;
  }

  /**
   * Accepts an inquiry. Always answers the same way whether or not it was stored, so the
   * form cannot be used to probe schools or campuses; bots filling the honeypot are
   * silently dropped.
   */
  async inquiry(
    slug: string,
    input: PublicInquiryInput,
    client: ClientInfo,
  ): Promise<{ received: true }> {
    this.limiter.consume(`inquiry-ip:${client.ip}`, 5, 10 * MINUTE);
    this.limiter.consume(`inquiry-phone:${input.phone}`, 3, 60 * MINUTE);
    if (input.website) return { received: true };
    await withContext(this.handle.db, { requestId: client.requestId }, (tx) =>
      tx.execute(sql`select app.public_inquiry_create(
        ${slug}, ${input.campusId}, ${input.parentName}, ${input.phone}, ${input.email},
        ${input.studentName}, ${input.classSought}, ${input.message}) as ok`),
    );
    return { received: true };
  }
}
