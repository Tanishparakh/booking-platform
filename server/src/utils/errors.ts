import { z, ZodTypeAny } from 'zod';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'ERROR') {
    super(message);
  }
}

export const badRequest = (m: string) => new ApiError(400, m, 'BAD_REQUEST');
export const unauthorized = (m = 'Authentication required') => new ApiError(401, m, 'UNAUTHORIZED');
export const forbidden = (m = 'You are not allowed to do this') => new ApiError(403, m, 'FORBIDDEN');
export const notFound = (m = 'Not found') => new ApiError(404, m, 'NOT_FOUND');
export const conflict = (m: string) => new ApiError(409, m, 'CONFLICT');

/** Parse and validate input with a zod schema; throws a 400 with a readable message. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
    throw badRequest(msg);
  }
  return result.data;
}
