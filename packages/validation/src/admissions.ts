import { z } from 'zod';
import { emailSchema } from './auth.js';
import { isoDateSchema } from './academic.js';
import { paginationQuerySchema } from './common.js';
import {
  ACK_CHANNELS,
  GENDERS,
  RELATIONSHIPS,
  aadhaarSchema,
  guardianInputSchema,
} from './students.js';
import { indianPhoneSchema } from './tenancy.js';

export const APPLICATION_STATUSES = [
  'submitted',
  'under_review',
  'assessment',
  'approved',
  'waitlisted',
  'rejected',
  'withdrawn',
  'admitted',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/**
 * Allowed moves. "admitted" is reached only through the admit action, which creates the
 * student; withdrawn and admitted are final.
 */
export const APPLICATION_TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  submitted: ['under_review', 'rejected', 'withdrawn'],
  under_review: ['assessment', 'approved', 'waitlisted', 'rejected', 'withdrawn'],
  assessment: ['approved', 'waitlisted', 'rejected', 'withdrawn'],
  waitlisted: ['approved', 'rejected', 'withdrawn'],
  approved: ['waitlisted', 'withdrawn'],
  rejected: ['under_review'],
  withdrawn: [],
  admitted: [],
};

export const APPLICATION_SOURCES = ['website', 'walk_in', 'phone', 'referral', 'other'] as const;

const nullable = <T extends z.ZodType>(s: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), s.nullable());

const applicantFields = {
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().max(60),
  dateOfBirth: isoDateSchema,
  gender: z.enum(GENDERS),
  previousSchool: nullable(z.string().trim().max(150)),
  guardianName: z.string().trim().min(2).max(100),
  guardianPhone: indianPhoneSchema,
  guardianEmail: nullable(emailSchema),
  guardianRelationship: z.enum(RELATIONSHIPS),
  notes: z.string().trim().max(2000),
};

export const applicationCreateSchema = z.object({
  campusId: z.uuid(),
  academicYearId: z.uuid(),
  gradeLevelId: z.uuid(),
  /** Start from an inquiry: source and contact details come from it unless given. */
  inquiryId: z.uuid().nullable().default(null),
  source: z.enum(APPLICATION_SOURCES).optional(),
  ...applicantFields,
  lastName: applicantFields.lastName.default(''),
  previousSchool: applicantFields.previousSchool.default(null),
  guardianEmail: applicantFields.guardianEmail.default(null),
  notes: applicantFields.notes.default(''),
});
export type ApplicationCreateInput = z.infer<typeof applicationCreateSchema>;

export const applicationUpdateSchema = z
  .object(applicantFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type ApplicationUpdateInput = z.infer<typeof applicationUpdateSchema>;

export const applicationTransitionSchema = z
  .object({
    status: z.enum(APPLICATION_STATUSES).exclude(['admitted', 'submitted']),
    note: z.string().trim().max(1000).default(''),
    /** Required when moving to "assessment". */
    assessmentAt: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((v) => v.status !== 'assessment' || v.assessmentAt, {
    message: 'Choose the assessment date and time',
    path: ['assessmentAt'],
  })
  .refine(
    (v) => !['rejected', 'withdrawn', 'waitlisted'].includes(v.status) || v.note.length >= 3,
    {
      message: 'Add a short reason',
      path: ['note'],
    },
  );
export type ApplicationTransitionInput = z.infer<typeof applicationTransitionSchema>;

/** Admitting an approved application: the rest comes from the application. */
export const applicationAdmitSchema = z.object({
  sectionId: z.uuid(),
  rollNumber: z.number().int().min(1).max(999).nullable().default(null),
  admissionDate: isoDateSchema.optional(),
  /** Link the applicant's parent to an existing guardian (sibling) instead of creating one. */
  existingGuardianId: z.uuid().nullable().default(null),
  additionalGuardians: z.array(guardianInputSchema).max(3).default([]),
  aadhaar: nullable(aadhaarSchema).default(null),
  privacyNotice: z.object({
    acknowledged: z.literal(true, 'The parent must acknowledge the privacy notice'),
    version: z.string().trim().min(1).max(40),
    channel: z.enum(ACK_CHANNELS),
  }),
});
export type ApplicationAdmitInput = z.infer<typeof applicationAdmitSchema>;

export const applicationListQuerySchema = paginationQuerySchema.extend({
  campusId: z.uuid().optional(),
  academicYearId: z.uuid().optional(),
  gradeLevelId: z.uuid().optional(),
  status: z.enum(APPLICATION_STATUSES).optional(),
  q: z.string().trim().max(60).optional(),
});
export type ApplicationListQuery = z.infer<typeof applicationListQuerySchema>;

export const applicationSummaryQuerySchema = z.object({
  campusId: z.uuid(),
  academicYearId: z.uuid(),
});

/* ------------------------------------ documents ------------------------------------ */

export const DOCUMENT_TYPES = [
  'birth_certificate',
  'transfer_certificate',
  'report_card',
  'photo',
  'address_proof',
  'aadhaar_card',
  'caste_certificate',
  'medical',
  'other',
] as const;
export const SENSITIVE_DOCUMENT_TYPES: readonly string[] = [
  'aadhaar_card',
  'caste_certificate',
  'medical',
];
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

export const documentUploadFieldsSchema = z
  .object({
    studentId: z.uuid().optional(),
    applicationId: z.uuid().optional(),
    docType: z.enum(DOCUMENT_TYPES),
  })
  .refine((v) => Boolean(v.studentId) !== Boolean(v.applicationId), {
    message: 'Attach the document to a student or an application',
    path: ['studentId'],
  });
