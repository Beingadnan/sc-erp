import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { campuses, tenants, users } from './platform.js';
import { idColumn, timestamps } from './types.js';

/* ------------------------------------------------------------------------------------
 * Phase 3b — school website pages (CMS) and website inquiries.
 *
 * The public site never reads these tables directly: anonymous visitors go through
 * SECURITY DEFINER functions (app.public_*) that return only published content of an
 * active school, and accept inquiries for it.
 * ---------------------------------------------------------------------------------- */

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' });

export const cmsPages = pgTable(
  'cms_pages',
  {
    id: idColumn(),
    tenantId: tenantId(),
    /** URL part: /s/<school>/<slug>. "home" is the landing page. */
    slug: text('slug').notNull(),
    /** Working copy shown in the editor (latest version's title). */
    title: text('title').notNull(),
    /** Version visitors see; null = not published. */
    publishedVersionId: uuid('published_version_id'),
    showInNav: boolean('show_in_nav').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique('cms_pages_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('cms_pages_tenant_slug_uq').on(t.tenantId, t.slug),
    check('cms_pages_slug_chk', sql`${t.slug} ~ '^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$'`),
  ],
);

export const cmsPageVersions = pgTable(
  'cms_page_versions',
  {
    id: idColumn(),
    tenantId: tenantId(),
    pageId: uuid('page_id').notNull(),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    /** Restricted Markdown (no HTML); rendered by our own safe renderer. */
    body: text('body').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('cms_page_versions_tenant_id_id_uq').on(t.tenantId, t.id),
    unique('cms_page_versions_page_version_uq').on(t.tenantId, t.pageId, t.version),
    foreignKey({
      name: 'cms_page_versions_page_fk',
      columns: [t.tenantId, t.pageId],
      foreignColumns: [cmsPages.tenantId, cmsPages.id],
    }).onDelete('cascade'),
    check('cms_page_versions_body_len_chk', sql`length(${t.body}) <= 50000`),
  ],
);

export const admissionInquiries = pgTable(
  'admission_inquiries',
  {
    id: idColumn(),
    tenantId: tenantId(),
    campusId: uuid('campus_id'),
    parentName: text('parent_name').notNull(),
    phone: text('phone').notNull(),
    email: text('email'),
    studentName: text('student_name'),
    classSought: text('class_sought'),
    message: text('message').notNull().default(''),
    /** website | walk_in | phone | referral | other */
    source: text('source').notNull().default('website'),
    /** new → contacted → closed (Phase 4 converts inquiries into applications). */
    status: text('status').notNull().default('new'),
    /** Parent agreed to be contacted about admission (DPDP consent record). */
    consentAt: timestamp('consent_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    unique('admission_inquiries_tenant_id_id_uq').on(t.tenantId, t.id),
    foreignKey({
      name: 'admission_inquiries_campus_fk',
      columns: [t.tenantId, t.campusId],
      foreignColumns: [campuses.tenantId, campuses.id],
    }),
    index('admission_inquiries_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    check(
      'admission_inquiries_source_chk',
      sql`${t.source} in ('website', 'walk_in', 'phone', 'referral', 'other')`,
    ),
    check('admission_inquiries_status_chk', sql`${t.status} in ('new', 'contacted', 'closed')`),
    check('admission_inquiries_phone_chk', sql`${t.phone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check('admission_inquiries_message_len_chk', sql`length(${t.message}) <= 2000`),
  ],
);
// cms_pages.published_version_id → cms_page_versions is added in 0007 (circular reference).
