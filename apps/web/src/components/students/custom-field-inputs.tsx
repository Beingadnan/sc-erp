'use client';

import type { CustomFieldDefinition } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { Field, SelectField } from '@/components/ui';

/** The school's active custom fields for an entity. */
export function useCustomFields(entity: 'student' | 'guardian') {
  const { data } = useApi<{ student: CustomFieldDefinition[]; guardian: CustomFieldDefinition[] }>(
    '/custom-fields',
  );
  return (data?.[entity] ?? []).filter((f) => !f.archived);
}

/** Collects `cf_<key>` inputs from a form into { key: value }. */
export const readCustomFields = (form: FormData, defs: CustomFieldDefinition[]) =>
  Object.fromEntries(defs.map((d) => [d.key, String(form.get(`cf_${d.key}`) ?? '')]));

/** Inputs named cf_<key>; errors come back as customFields.<key>. */
export function CustomFieldInputs({
  defs,
  values = {},
  errors = {},
}: {
  defs: CustomFieldDefinition[];
  values?: Record<string, string | number>;
  errors?: Record<string, string>;
}) {
  return (
    <>
      {defs.map((d) => {
        const label = d.required ? d.label : `${d.label} (optional)`;
        const error = errors[`customFields.${d.key}`];
        const value = values[d.key] === undefined ? '' : String(values[d.key]);
        return d.fieldType === 'select' ? (
          <SelectField
            key={d.key}
            label={label}
            name={`cf_${d.key}`}
            defaultValue={value}
            error={error}
          >
            <option value="">{d.required ? 'Choose' : 'Not set'}</option>
            {d.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </SelectField>
        ) : (
          <Field
            key={d.key}
            label={label}
            name={`cf_${d.key}`}
            type={d.fieldType === 'number' ? 'number' : d.fieldType === 'date' ? 'date' : 'text'}
            step={d.fieldType === 'number' ? 'any' : undefined}
            defaultValue={value}
            error={error}
          />
        );
      })}
    </>
  );
}
