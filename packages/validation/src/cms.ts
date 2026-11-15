import { z } from 'zod';
import { emailSchema } from './auth.js';
import { paginationQuerySchema } from './common.js';
import { indianPhoneSchema } from './tenancy.js';

/** Words that would clash with public site routes. */
const RESERVED_PAGE_SLUGS = new Set(['inquiry', 'admin', 'api', 'login']);

export const pageSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/, 'Lowercase letters, numbers and - (up to 50)')
  .refine((s) => !RESERVED_PAGE_SLUGS.has(s), 'This address is reserved');

const pageTitle = z.string().trim().min(2).max(120);
const pageBody = z.string().max(50_000, 'Page is too long (50,000 characters at most)');

export const cmsPageCreateSchema = z.object({
  slug: pageSlugSchema,
  title: pageTitle,
  body: pageBody.default(''),
  showInNav: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});
export type CmsPageCreateInput = z.infer<typeof cmsPageCreateSchema>;

/** Saving title/body creates a new version; the other fields change the page itself. */
export const cmsPageUpdateSchema = z
  .object({
    slug: pageSlugSchema,
    title: pageTitle,
    body: pageBody,
    showInNav: z.boolean(),
    sortOrder: z.number().int().min(0).max(1000),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')
  .refine((v) => (v.body === undefined) === (v.title === undefined), {
    message: 'Send the title and the body together',
    path: ['body'],
  });
export type CmsPageUpdateInput = z.infer<typeof cmsPageUpdateSchema>;

export const cmsPublishSchema = z.object({
  /** Version to publish; latest when omitted. */
  version: z.number().int().min(1).optional(),
});

/* ------------------------------------- inquiries ------------------------------------- */

const inquiryFields = {
  campusId: z.uuid().nullable().default(null),
  parentName: z.string().trim().min(2).max(100),
  phone: indianPhoneSchema,
  email: emailSchema.nullable().default(null),
  studentName: z.string().trim().max(100).nullable().default(null),
  classSought: z.string().trim().max(40).nullable().default(null),
  message: z.string().trim().max(2000).default(''),
};

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

/** Public website form. `website` is a honeypot field that people never fill in. */
export const publicInquirySchema = z.object({
  ...inquiryFields,
  email: z.preprocess(emptyToNull, emailSchema.nullable()).default(null),
  studentName: z.preprocess(emptyToNull, z.string().trim().max(100).nullable()).default(null),
  classSought: z.preprocess(emptyToNull, z.string().trim().max(40).nullable()).default(null),
  campusId: z.preprocess(emptyToNull, z.uuid().nullable()).default(null),
  consent: z.literal(true, 'Please agree to be contacted about admission'),
  website: z.string().max(200).optional(),
});
export type PublicInquiryInput = z.infer<typeof publicInquirySchema>;

/** Staff recording a walk-in or phone inquiry. */
export const inquiryCreateSchema = z.object({
  ...inquiryFields,
  source: z.enum(['walk_in', 'phone', 'referral', 'other']),
  consent: z.literal(true, 'Confirm the parent agreed to be contacted'),
});
export type InquiryCreateInput = z.infer<typeof inquiryCreateSchema>;

export const INQUIRY_STATUSES = ['new', 'contacted', 'closed'] as const;
export const inquiryStatusSchema = z.object({ status: z.enum(INQUIRY_STATUSES) });

export const inquiryListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(INQUIRY_STATUSES).optional(),
  campusId: z.uuid().optional(),
});
