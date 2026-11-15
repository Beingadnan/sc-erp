import { describe, expect, it } from 'vitest';
import {
  importRowSchema,
  normaliseHeader,
  promotionSchema,
  validateCustomValues,
} from './records.js';

const row = {
  first_name: 'Aarav',
  date_of_birth: '15/06/2019',
  gender: 'Boy',
  class: 'Class 1',
  section: 'A',
  parent_name: 'Rakesh Sharma',
  parent_phone: '98290 12345',
};

describe('import rows', () => {
  it('accepts Indian date formats and gender words', () => {
    const r = importRowSchema.parse(row);
    expect(r).toMatchObject({
      date_of_birth: '2019-06-15',
      gender: 'male',
      parent_phone: '+919829012345',
    });
    expect(r.last_name).toBeNull();
    expect(importRowSchema.parse({ ...row, date_of_birth: '2019-06-15', gender: 'F' }).gender).toBe(
      'female',
    );
  });

  it('reports bad cells by column', () => {
    const r = importRowSchema.safeParse({
      ...row,
      date_of_birth: '31/02/2019',
      gender: 'x',
      parent_phone: '12',
    });
    expect(r.error!.issues.map((i) => i.path[0]).sort()).toEqual([
      'date_of_birth',
      'gender',
      'parent_phone',
    ]);
    expect(importRowSchema.safeParse({ ...row, second_parent_name: 'Sunita' }).success).toBe(false);
  });

  it('understands common header spellings', () => {
    expect(
      ['DOB', 'Date of Birth', 'Adm. No', 'Father Name', 'Aadhar'].map(normaliseHeader),
    ).toEqual(['date_of_birth', 'date_of_birth', 'admission_number', 'parent_name', 'aadhaar']);
  });
});

describe('custom field values', () => {
  const defs = [
    {
      key: 'house',
      label: 'House',
      fieldType: 'select' as const,
      options: ['Red', 'Blue'],
      required: true,
      archived: false,
    },
    {
      key: 'height_cm',
      label: 'Height',
      fieldType: 'number' as const,
      options: [],
      required: false,
      archived: false,
    },
    {
      key: 'old',
      label: 'Old',
      fieldType: 'text' as const,
      options: [],
      required: false,
      archived: true,
    },
  ];

  it('validates by type and requires required fields', () => {
    expect(validateCustomValues(defs, { house: 'Red', height_cm: '120' })).toEqual({
      values: { house: 'Red', height_cm: 120 },
      errors: {},
    });
    expect(
      validateCustomValues(defs, { house: 'Green', height_cm: 'tall', old: 'x', extra: 1 }).errors,
    ).toEqual({
      house: 'Choose one of: Red, Blue',
      height_cm: 'Enter a number',
      old: 'Unknown field',
      extra: 'Unknown field',
    });
    expect(validateCustomValues(defs, {}).errors).toEqual({ house: 'House is required' });
    expect(validateCustomValues(defs, { height_cm: 1 }, { partial: true }).errors).toEqual({});
  });
});

describe('promotion', () => {
  it('needs a target section for promote and retain', () => {
    const id = '01920000-0000-7000-8000-000000000001';
    const base = { fromSectionId: id, toAcademicYearId: id };
    expect(
      promotionSchema.safeParse({ ...base, items: [{ enrollmentId: id, action: 'promote' }] })
        .success,
    ).toBe(false);
    expect(
      promotionSchema.safeParse({ ...base, items: [{ enrollmentId: id, action: 'complete' }] })
        .success,
    ).toBe(true);
  });
});
