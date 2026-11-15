'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AcademicYear, GradeLevel, Section } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { SelectField } from '@/components/ui';

export interface SectionChoice {
  academicYearId: string | null;
  gradeLevelId: string | null;
  sectionId: string | null;
}

/**
 * Year → class → section selects for one campus. Defaults to the current year.
 * With `allowAll`, class and section can be left as "All" (for filtering lists).
 */
export function SectionPicker({
  campusId,
  value,
  onChange,
  allowAll = false,
  error,
}: {
  campusId: string;
  value: SectionChoice;
  onChange: (v: SectionChoice) => void;
  allowAll?: boolean;
  error?: string;
}) {
  const years = useApi<AcademicYear[]>(`/academic-years?campusId=${campusId}`);
  const classes = useApi<GradeLevel[]>(`/classes?campusId=${campusId}`);
  const sections = useApi<Section[]>(
    value.academicYearId ? `/sections?academicYearId=${value.academicYearId}` : null,
  );
  const [init, setInit] = useState(false);

  useEffect(() => {
    if (init || !years.data) return;
    setInit(true);
    if (value.academicYearId) return;
    const current =
      years.data.find((y) => y.isCurrent) ?? years.data.findLast((y) => y.status !== 'closed');
    if (current) onChange({ academicYearId: current.id, gradeLevelId: null, sectionId: null });
  }, [years.data, init, value.academicYearId, onChange]);

  const classOptions = useMemo(
    () => (classes.data ?? []).filter((c) => c.status === 'active'),
    [classes.data],
  );
  const sectionOptions = (sections.data ?? []).filter((s) => s.gradeLevelId === value.gradeLevelId);

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <SelectField
        label="Academic year"
        value={value.academicYearId ?? ''}
        onChange={(e) =>
          onChange({ academicYearId: e.target.value || null, gradeLevelId: null, sectionId: null })
        }
      >
        {allowAll && <option value="">Any year</option>}
        {(years.data ?? []).map((y) => (
          <option key={y.id} value={y.id}>
            {y.name}
            {y.isCurrent ? ' (current)' : y.status === 'closed' ? ' (closed)' : ''}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Class"
        value={value.gradeLevelId ?? ''}
        disabled={!value.academicYearId}
        onChange={(e) =>
          onChange({ ...value, gradeLevelId: e.target.value || null, sectionId: null })
        }
      >
        <option value="">{allowAll ? 'All classes' : 'Choose a class'}</option>
        {classOptions.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Section"
        value={value.sectionId ?? ''}
        disabled={!value.gradeLevelId}
        onChange={(e) => onChange({ ...value, sectionId: e.target.value || null })}
        error={error}
      >
        <option value="">{allowAll ? 'All sections' : 'Choose a section'}</option>
        {sectionOptions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.capacity ? ` (${s.capacity} seats)` : ''}
          </option>
        ))}
      </SelectField>
      {value.gradeLevelId && sections.data && !sectionOptions.length && (
        <p className="text-sm text-amber-700 sm:col-span-3">
          This class has no sections in the chosen year. Add one on the Classes &amp; sections page.
        </p>
      )}
    </div>
  );
}
