import express from 'express';
import mongoose, { Types } from 'mongoose';
import { ApiError, errorHandler } from './errors.js';
import { Shift, Volunteer } from './models.js';
import { id, listQuery, shiftInput, shiftPatch, signupInput, volunteerInput } from './validation.js';

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

app.get('/health', (_req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({ status: connected ? 'ok' : 'unavailable' });
});

app.post('/volunteers', async (req, res) => {
  const volunteer = await Volunteer.create(volunteerInput.parse(req.body));
  res.status(201).location(`/volunteers/${volunteer.id}`).json({ volunteer });
});

app.get('/volunteers/:id', async (req, res) => {
  const volunteer = await Volunteer.findById(id.parse(req.params.id));
  if (!volunteer) throw new ApiError(404, 'VOLUNTEER_NOT_FOUND', 'Volunteer not found');
  res.json({ volunteer });
});

app.post('/shifts', async (req, res) => {
  const shift = await Shift.create(shiftInput.parse(req.body));
  res.status(201).location(`/shifts/${shift.id}`).json({ shift });
});

app.get('/shifts', async (req, res) => {
  const query = listQuery.parse(req.query);
  const filter = {
    ...(query.from || query.to ? { startsAt: {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lt: query.to } : {}),
    } } : {}),
    ...(query.volunteerId ? { 'signups.volunteerId': new Types.ObjectId(query.volunteerId) } : {}),
  };
  const shifts = await Shift.find(filter).sort({ startsAt: 1, _id: 1 })
    .skip(query.offset).limit(query.limit + 1);
  res.json({ shifts: shifts.slice(0, query.limit), hasMore: shifts.length > query.limit });
});

app.get('/shifts/:id', async (req, res) => {
  const shift = await Shift.findById(id.parse(req.params.id));
  if (!shift) throw new ApiError(404, 'SHIFT_NOT_FOUND', 'Shift not found');
  res.json({ shift });
});

app.patch('/shifts/:id', async (req, res) => {
  const shiftId = id.parse(req.params.id);
  const patch = shiftPatch.parse(req.body);
  const current = await Shift.findById(shiftId);
  if (!current) throw new ApiError(404, 'SHIFT_NOT_FOUND', 'Shift not found');
  shiftInput.parse({
    title: current.title, description: current.description, location: current.location,
    startsAt: (patch.startsAt ?? current.startsAt).toISOString(),
    endsAt: (patch.endsAt ?? current.endsAt).toISOString(),
    capacity: patch.capacity ?? current.capacity,
  });
  if (patch.capacity !== undefined && patch.capacity < current.signups.length) {
    throw new ApiError(409, 'CAPACITY_TOO_LOW', 'Capacity cannot be lower than the number of signups');
  }
  // Every signup, cancellation, and edit advances the version checked here.
  const shift = await Shift.findOneAndUpdate({ _id: shiftId, __v: current.__v }, {
    $set: patch, $inc: { __v: 1 },
  }, { new: true, runValidators: true });
  if (!shift) throw new ApiError(409, 'SHIFT_CHANGED', 'Shift changed during this request; retry the update');
  res.json({ shift });
});

app.delete('/shifts/:id', async (req, res) => {
  const shiftId = id.parse(req.params.id);
  const deleted = await Shift.findOneAndDelete({ _id: shiftId, signups: { $size: 0 } });
  if (!deleted) {
    if (!await Shift.exists({ _id: shiftId })) throw new ApiError(404, 'SHIFT_NOT_FOUND', 'Shift not found');
    throw new ApiError(409, 'SHIFT_HAS_SIGNUPS', 'Cancel existing signups before deleting the shift');
  }
  res.sendStatus(204);
});

app.post('/shifts/:id/signups', async (req, res) => {
  const shiftId = id.parse(req.params.id);
  const { volunteerId } = signupInput.parse(req.body);
  if (!await Volunteer.exists({ _id: volunteerId })) {
    throw new ApiError(404, 'VOLUNTEER_NOT_FOUND', 'Volunteer not found');
  }
  const shift = await Shift.findOneAndUpdate({
    _id: shiftId,
    startsAt: { $gt: new Date() },
    'signups.volunteerId': { $ne: new Types.ObjectId(volunteerId) },
    $expr: { $lt: [{ $size: '$signups' }, '$capacity'] },
  }, {
    $push: { signups: { volunteerId, signedUpAt: new Date() } },
    $inc: { __v: 1 },
  }, { new: true });
  if (!shift) {
    if (!await Shift.exists({ _id: shiftId })) throw new ApiError(404, 'SHIFT_NOT_FOUND', 'Shift not found');
    throw new ApiError(409, 'SIGNUP_UNAVAILABLE', 'Shift has started, is full, or volunteer is already signed up');
  }
  res.status(201).json({ shift });
});

app.delete('/shifts/:id/signups/:volunteerId', async (req, res) => {
  const shiftId = id.parse(req.params.id);
  const volunteerId = id.parse(req.params.volunteerId);
  const shift = await Shift.findOneAndUpdate({ _id: shiftId }, {
    $pull: { signups: { volunteerId } }, $inc: { __v: 1 },
  }, { new: true });
  if (!shift) throw new ApiError(404, 'SHIFT_NOT_FOUND', 'Shift not found');
  res.sendStatus(204);
});

app.use((_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'Route not found')));
app.use(errorHandler);
