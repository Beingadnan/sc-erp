import { describe, expect, it } from 'vitest';
import { parseClassLabel, parseClassList, subjectCodeFrom } from './setup.js';

describe('class labels', () => {
  it('understands common ways to write a class', () => {
    expect(parseClassLabel('Class 5')).toMatchObject({
      code: '5',
      name: 'Class 5',
      stage: 'primary',
    });
    expect(parseClassLabel('VII')).toMatchObject({ code: '7', stage: 'middle' });
    expect(parseClassLabel('9th')).toMatchObject({ code: '9', stage: 'secondary' });
    expect(parseClassLabel('std 12')).toMatchObject({ code: '12', stage: 'senior_secondary' });
    expect(parseClassLabel('LKG')).toMatchObject({
      code: 'LKG',
      stage: 'pre_primary',
      sortOrder: 3,
    });
    expect(parseClassLabel('Nursery')).toMatchObject({ code: 'NUR' });
    expect(parseClassLabel('11 Science')).toMatchObject({
      code: '11-SCI',
      name: 'Class 11 Science',
    });
    expect(parseClassLabel('XII Commerce')).toMatchObject({ code: '12-COM' });
    expect(parseClassLabel('13')).toBeNull();
    expect(parseClassLabel('5 Science')).toBeNull();
    expect(parseClassLabel('Hostel')).toBeNull();
  });
  it('reads lists and ranges', () => {
    expect(parseClassList('All')).toEqual({ all: true, codes: [], bad: [] });
    expect(parseClassList('1-3, 5, LKG')).toEqual({
      all: false,
      codes: ['1', '2', '3', '5', 'LKG'],
      bad: [],
    });
    expect(parseClassList('6 to 8; Hostel').bad).toEqual(['Hostel']);
  });
  it('makes subject codes', () => {
    expect(subjectCodeFrom('Social Science')).toBe('SOCIALSC');
    expect(subjectCodeFrom('Hindi')).toBe('HINDI');
  });
});
