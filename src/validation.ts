import { z } from 'zod';

export const id = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Expected a MongoDB ObjectId');
const date = z.iso.datetime({ offset: true }).transform(value => new Date(value));
const text = (max: number) => z.string().trim().min(1).max(max);

export const volunteerInput = z.strictObject({
  name: text(100),
  email: z.email().max(254).transform(value => value.toLowerCase()),
});

const shiftFields = z.strictObject({
  title: text(120),
  description: z.string().trim().max(2000).optional(),
  location: text(200),
  startsAt: date,
  endsAt: date,
  capacity: z.number().int().min(1).max(500),
});

export const shiftInput = shiftFields.refine(value => value.endsAt > value.startsAt, {
  message: 'endsAt must be after startsAt', path: ['endsAt'],
});
export const shiftPatch = shiftFields.partial().refine(value => Object.keys(value).length > 0, {
  message: 'Provide at least one field to update',
});
export const signupInput = z.strictObject({ volunteerId: id });
export const listQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
  from: date.optional(),
  to: date.optional(),
  volunteerId: id.optional(),
}).refine(value => !value.from || !value.to || value.to > value.from, {
  message: 'to must be after from', path: ['to'],
});
