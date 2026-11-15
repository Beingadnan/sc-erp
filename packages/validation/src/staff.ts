import { z } from 'zod';
import { indianPhoneSchema } from './tenancy.js';

export const staffProfileSchema = z.object({
  designation: z.string().trim().max(80).default(''),
  employeeCode: z.string().trim().max(30).nullable().default(null),
  phone: indianPhoneSchema.nullable().default(null),
  joinedOn: z.iso.date().nullable().default(null),
});
export type StaffProfileInput = z.infer<typeof staffProfileSchema>;

export const teachingGridQuerySchema = z.object({
  campusId: z.uuid(),
  academicYearId: z.uuid().optional(),
});

/** Sets who teaches one subject in one section (empty list = nobody). */
export const teachingCellSchema = z.object({
  sectionId: z.uuid(),
  subjectId: z.uuid(),
  membershipIds: z.array(z.uuid()).max(3),
});
export type TeachingCellInput = z.infer<typeof teachingCellSchema>;
