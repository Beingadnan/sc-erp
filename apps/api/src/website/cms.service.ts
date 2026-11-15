import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, max } from 'drizzle-orm';
import type { DatabaseHandle, Transaction } from '@school-erp/db';
import { schema, withTenant } from '@school-erp/db';
import { AppError, notFound } from '@school-erp/shared';
import type { CmsPageCreateInput, CmsPageUpdateInput } from '@school-erp/validation';
import { DB_HANDLE } from '../database/database.module.js';
import { rethrowConflicts } from '../common/pg-errors.js';
import type { TenantAccess } from '../auth/access.js';
import { AuditService } from '../tenancy/audit.service.js';
import { STARTER_PAGES } from './starter-pages.js';

const p = schema.cmsPages;
const v = schema.cmsPageVersions;

const PAGE_CONFLICTS = { cms_pages_tenant_slug_uq: 'Another page already uses this address' };

/** Pages are school-wide, so editing them needs cms.manage for every campus. */
const assertCanManage = (access: TenantAccess) => {
  if (!access.hasTenantWide('cms.manage')) {
    throw new AppError('FORBIDDEN', 'You do not have permission to edit the website');
  }
};

@Injectable()
export class CmsService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DatabaseHandle,
    private readonly audit: AuditService,
  ) {}

  list(access: TenantAccess) {
    assertCanManage(access);
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const pages = await tx
          .select({
            id: p.id,
            slug: p.slug,
            title: p.title,
            showInNav: p.showInNav,
            sortOrder: p.sortOrder,
            publishedVersionId: p.publishedVersionId,
            updatedAt: p.updatedAt,
          })
          .from(p)
          .orderBy(asc(p.sortOrder), asc(p.title));
        const latest = await tx
          .select({ pageId: v.pageId, version: max(v.version) })
          .from(v)
          .groupBy(v.pageId);
        const published = await tx
          .select({ id: v.id, version: v.version })
          .from(v)
          .innerJoin(p, and(eq(p.tenantId, v.tenantId), eq(p.publishedVersionId, v.id)));
        return pages.map(({ publishedVersionId, ...page }) => {
          const latestVersion = latest.find((l) => l.pageId === page.id)?.version ?? 0;
          const publishedVersion =
            published.find((x) => x.id === publishedVersionId)?.version ?? null;
          return {
            ...page,
            latestVersion,
            publishedVersion,
            /** Saved changes that visitors do not see yet. */
            hasDraftChanges: publishedVersion !== null && publishedVersion !== latestVersion,
          };
        });
      },
      { readOnly: true },
    );
  }

  private async loadPage(tx: Transaction, id: string) {
    const [page] = await tx.select().from(p).where(eq(p.id, id));
    if (!page) throw notFound('Page');
    return page;
  }

  get(access: TenantAccess, id: string) {
    assertCanManage(access);
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const page = await this.loadPage(tx, id);
        const versions = await tx
          .select({
            id: v.id,
            version: v.version,
            title: v.title,
            createdAt: v.createdAt,
            createdByName: schema.users.fullName,
          })
          .from(v)
          .leftJoin(schema.users, eq(schema.users.id, v.createdBy))
          .where(eq(v.pageId, id))
          .orderBy(desc(v.version));
        const [latest] = await tx
          .select({ body: v.body, title: v.title, version: v.version })
          .from(v)
          .where(eq(v.pageId, id))
          .orderBy(desc(v.version))
          .limit(1);
        return {
          id: page.id,
          slug: page.slug,
          title: latest?.title ?? page.title,
          body: latest?.body ?? '',
          showInNav: page.showInNav,
          sortOrder: page.sortOrder,
          latestVersion: latest?.version ?? 0,
          publishedVersion: versions.find((x) => x.id === page.publishedVersionId)?.version ?? null,
          versions,
        };
      },
      { readOnly: true },
    );
  }

  getVersion(access: TenantAccess, id: string, version: number) {
    assertCanManage(access);
    return withTenant(
      this.handle.db,
      access.ctx,
      async (tx) => {
        const [row] = await tx
          .select({ version: v.version, title: v.title, body: v.body, createdAt: v.createdAt })
          .from(v)
          .where(and(eq(v.pageId, id), eq(v.version, version)));
        if (!row) throw notFound('Version');
        return row;
      },
      { readOnly: true },
    );
  }

  private async addVersion(
    tx: Transaction,
    access: TenantAccess,
    pageId: string,
    title: string,
    body: string,
  ) {
    // Serialise version numbering per page (row lock on the page).
    await tx.select({ id: p.id }).from(p).where(eq(p.id, pageId)).for('update');
    const [current] = await tx
      .select({ latest: max(v.version) })
      .from(v)
      .where(eq(v.pageId, pageId));
    const next = (current?.latest ?? 0) + 1;
    const [row] = await tx
      .insert(v)
      .values({
        tenantId: access.tenantId,
        pageId,
        version: next,
        title,
        body,
        createdBy: access.userId,
      })
      .returning({ id: v.id, version: v.version });
    await tx.update(p).set({ title, updatedAt: new Date() }).where(eq(p.id, pageId));
    return row!;
  }

  create(access: TenantAccess, input: CmsPageCreateInput) {
    assertCanManage(access);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      try {
        const [page] = await tx
          .insert(p)
          .values({
            tenantId: access.tenantId,
            slug: input.slug,
            title: input.title,
            showInNav: input.showInNav,
            sortOrder: input.sortOrder,
          })
          .returning({ id: p.id });
        await this.addVersion(tx, access, page!.id, input.title, input.body);
        await this.audit.record(tx, access, {
          action: 'page.created',
          entity: 'cms_page',
          entityId: page!.id,
          diff: { slug: input.slug, title: input.title },
        });
        return { id: page!.id };
      } catch (err) {
        return rethrowConflicts(err, PAGE_CONFLICTS);
      }
    });
  }

  update(access: TenantAccess, id: string, input: CmsPageUpdateInput) {
    assertCanManage(access);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      await this.loadPage(tx, id);
      const { title, body, ...meta } = input;
      let version: number | undefined;
      try {
        if (Object.keys(meta).length) {
          await tx
            .update(p)
            .set({ ...meta, updatedAt: new Date() })
            .where(eq(p.id, id));
        }
      } catch (err) {
        return rethrowConflicts(err, PAGE_CONFLICTS);
      }
      if (title !== undefined && body !== undefined) {
        version = (await this.addVersion(tx, access, id, title, body)).version;
      }
      await this.audit.record(tx, access, {
        action: 'page.updated',
        entity: 'cms_page',
        entityId: id,
        // The body can be long; record what changed, not the text.
        diff: { ...meta, ...(title !== undefined ? { title, version } : {}) },
      });
      return { id, version };
    });
  }

  /** Publishes a saved version (latest by default). */
  publish(access: TenantAccess, id: string, version?: number) {
    assertCanManage(access);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      await this.loadPage(tx, id);
      const [target] = await tx
        .select({ id: v.id, version: v.version, title: v.title })
        .from(v)
        .where(version ? and(eq(v.pageId, id), eq(v.version, version)) : eq(v.pageId, id))
        .orderBy(desc(v.version))
        .limit(1);
      if (!target) throw notFound('Version');
      await tx
        .update(p)
        .set({ publishedVersionId: target.id, updatedAt: new Date() })
        .where(eq(p.id, id));
      await this.audit.record(tx, access, {
        action: 'page.published',
        entity: 'cms_page',
        entityId: id,
        diff: { version: target.version, title: target.title },
      });
      return { publishedVersion: target.version };
    });
  }

  unpublish(access: TenantAccess, id: string) {
    assertCanManage(access);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      await this.loadPage(tx, id);
      await tx
        .update(p)
        .set({ publishedVersionId: null, updatedAt: new Date() })
        .where(eq(p.id, id));
      await this.audit.record(tx, access, {
        action: 'page.unpublished',
        entity: 'cms_page',
        entityId: id,
      });
    });
  }

  /** Copies an old version into a new latest version (history is never rewritten). */
  restore(access: TenantAccess, id: string, version: number) {
    assertCanManage(access);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      await this.loadPage(tx, id);
      const [old] = await tx
        .select({ title: v.title, body: v.body })
        .from(v)
        .where(and(eq(v.pageId, id), eq(v.version, version)));
      if (!old) throw notFound('Version');
      const row = await this.addVersion(tx, access, id, old.title, old.body);
      await this.audit.record(tx, access, {
        action: 'page.restored',
        entity: 'cms_page',
        entityId: id,
        diff: { from: version, version: row.version },
      });
      return { version: row.version };
    });
  }

  remove(access: TenantAccess, id: string) {
    assertCanManage(access);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      const page = await this.loadPage(tx, id);
      // Clear the self-reference first so the versions can go with the page.
      await tx.update(p).set({ publishedVersionId: null }).where(eq(p.id, id));
      await tx.delete(p).where(eq(p.id, id));
      await this.audit.record(tx, access, {
        action: 'page.deleted',
        entity: 'cms_page',
        entityId: id,
        diff: { slug: page.slug, title: page.title },
      });
    });
  }

  /** Adds Home, About, Admissions and Contact as drafts; skips addresses already used. */
  createStarterPages(access: TenantAccess, schoolName: string) {
    assertCanManage(access);
    return withTenant(this.handle.db, access.ctx, async (tx) => {
      let created = 0;
      for (const [i, page] of STARTER_PAGES.entries()) {
        const [row] = await tx
          .insert(p)
          .values({ tenantId: access.tenantId, slug: page.slug, title: page.title, sortOrder: i })
          .onConflictDoNothing()
          .returning({ id: p.id });
        if (!row) continue;
        await this.addVersion(tx, access, row.id, page.title, page.body(schoolName));
        created++;
      }
      await this.audit.record(tx, access, {
        action: 'page.starter_created',
        entity: 'cms_page',
        entityId: null,
        diff: { created },
      });
      return { created };
    });
  }
}
