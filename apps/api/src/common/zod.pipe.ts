import { Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from '@school-erp/shared';

/**
 * Validates and normalises input with a shared Zod schema. Failures return 422 with
 * field messages (never the submitted values).
 */
@Injectable()
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value ?? {});
    if (result.success) return result.data;
    const fields: Record<string, string> = {};
    for (const issue of flattenUnions(result.error.issues)) {
      const key = issue.path.join('.') || '_';
      fields[key] ??= issue.message;
    }
    throw new AppError('VALIDATION_FAILED', 'Some fields need attention', { fields });
  }
}

export const zod = <S extends z.ZodType>(schema: S): ZodPipe<S> => new ZodPipe(schema);

type Issue = {
  code: string;
  path: PropertyKey[];
  message: string;
  errors?: Issue[][];
  input?: unknown;
};

/**
 * For "either A or B" inputs, report the errors of the alternative the client most likely
 * meant: the one with the fewest missing fields, then the fewest errors.
 */
export const flattenUnions = (issues: readonly Issue[]): Issue[] =>
  issues.flatMap((issue) => {
    if (issue.code !== 'invalid_union' || !issue.errors?.length) return [issue];
    const missing = (branch: Issue[]) =>
      branch.filter((i) => i.code === 'invalid_type' && i.input === undefined).length;
    const best = [...issue.errors].sort(
      (a, b) => missing(a) - missing(b) || a.length - b.length,
    )[0]!;
    return flattenUnions(best.map((i) => ({ ...i, path: [...issue.path, ...i.path] })));
  });
