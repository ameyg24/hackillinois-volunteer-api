import mongoose, { Types } from 'mongoose';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AddressInfo } from 'node:net';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { Shift, Volunteer } from '../src/models.js';

let database: MongoMemoryServer;
const missingId = new Types.ObjectId().toString();
const futureShift = (overrides: Record<string, unknown> = {}) => ({
  title: 'Check-in desk',
  location: 'Siebel Center lobby',
  startsAt: new Date(Date.now() + 86400000).toISOString(),
  endsAt: new Date(Date.now() + 90000000).toISOString(),
  capacity: 2,
  ...overrides,
});

async function createVolunteer(email = 'volunteer@example.com') {
  const response = await request(app).post('/volunteers').send({ name: 'Sam', email }).expect(201);
  return response.body.volunteer._id as string;
}

async function createShift(overrides: Record<string, unknown> = {}) {
  const response = await request(app).post('/shifts').send(futureShift(overrides)).expect(201);
  return response.body.shift._id as string;
}

const signup = (shiftId: string, volunteerId: string) =>
  request(app).post(`/shifts/${shiftId}/signups`).send({ volunteerId });

beforeAll(async () => {
  database = await MongoMemoryServer.create();
  await mongoose.connect(database.getUri());
  await Promise.all([Volunteer.init(), Shift.init()]);
});

beforeEach(async () => {
  await Promise.all([Shift.deleteMany({}), Volunteer.deleteMany({})]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await database?.stop();
});

describe('volunteers', () => {
  it('registers and retrieves a volunteer with a normalized email', async () => {
    const volunteerId = await createVolunteer('Sam@Example.com');
    const response = await request(app).get(`/volunteers/${volunteerId}`).expect(200);
    expect(response.body.volunteer).toMatchObject({ name: 'Sam', email: 'sam@example.com' });
  });

  it('enforces unique emails even for simultaneous registrations', async () => {
    const responses = await Promise.all(['Sam@example.com', 'sam@example.com'].map(email =>
      request(app).post('/volunteers').send({ name: 'Sam', email })));
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    expect(await Volunteer.countDocuments()).toBe(1);
  });

  it.each([
    { name: '', email: 'sam@example.com' },
    { name: 'Sam', email: 'invalid' },
    { name: 'Sam', email: 'sam@example.com', role: 'admin' },
  ])('rejects invalid volunteer data: %j', async body => {
    await request(app).post('/volunteers').send(body).expect(400);
  });

  it('returns 404 for a missing volunteer', async () => {
    await request(app).get(`/volunteers/${missingId}`).expect(404);
  });
});

describe('shifts', () => {
  it('creates, edits, and deletes an empty shift', async () => {
    const shiftId = await createShift();
    const edited = await request(app).patch(`/shifts/${shiftId}`)
      .send({ title: 'Help desk', capacity: 3 }).expect(200);
    expect(edited.body.shift).toMatchObject({ title: 'Help desk', capacity: 3 });
    await request(app).delete(`/shifts/${shiftId}`).expect(204);
    await request(app).get(`/shifts/${shiftId}`).expect(404);
  });

  it.each([
    { capacity: 0 }, { capacity: 1.5 }, { capacity: 501 }, { capacity: '2' },
    { startsAt: '2027-02-26' }, { startsAt: '2027-02-26T12:00:00' },
    { startsAt: '2027-02-26T15:00:00Z', endsAt: '2027-02-26T14:00:00Z' },
    { location: ' ' }, { signups: [] },
  ])('rejects invalid shift fields: %j', async fields => {
    await request(app).post('/shifts').send(futureShift(fields)).expect(400);
  });

  it('checks a partial time update against the existing time range', async () => {
    const shiftId = await createShift();
    await request(app).patch(`/shifts/${shiftId}`)
      .send({ endsAt: new Date().toISOString() }).expect(400);
    await request(app).patch(`/shifts/${shiftId}`).send({}).expect(400);
    await request(app).patch(`/shifts/${shiftId}`).send({ signups: [] }).expect(400);
  });

  it('paginates in chronological order and filters by a half-open date range', async () => {
    const times = [3, 1, 2].map(day => `2030-02-0${day}T12:00:00Z`);
    for (const startsAt of times) {
      await createShift({ startsAt, endsAt: startsAt.replace('12:', '13:') });
    }
    const first = await request(app).get('/shifts?limit=2').expect(200);
    expect(first.body.hasMore).toBe(true);
    expect(first.body.shifts.map((shift: { startsAt: string }) => shift.startsAt))
      .toEqual(['2030-02-01T12:00:00.000Z', '2030-02-02T12:00:00.000Z']);
    const last = await request(app).get('/shifts?limit=2&offset=2').expect(200);
    expect(last.body.hasMore).toBe(false);
    expect(last.body.shifts).toHaveLength(1);
    const filtered = await request(app).get('/shifts')
      .query({ from: '2030-02-02T12:00:00Z', to: '2030-02-03T12:00:00Z' }).expect(200);
    expect(filtered.body.shifts).toHaveLength(1);
    expect(filtered.body.shifts[0].startsAt).toBe('2030-02-02T12:00:00.000Z');
  });

  it.each(['limit=0', 'limit=101', 'offset=-1', 'from=yesterday', 'volunteerId=nope', 'unknown=1'])
    ('rejects invalid query parameters: %s', async query => {
      await request(app).get(`/shifts?${query}`).expect(400);
    });

  it('rejects reversed date filters', async () => {
    await request(app).get('/shifts').query({
      from: '2030-02-03T12:00:00Z', to: '2030-02-01T12:00:00Z',
    }).expect(400);
  });
});

describe('signups', () => {
  it('lists a volunteer’s shifts and frees a spot after cancellation', async () => {
    const shiftId = await createShift({ capacity: 1 });
    const sam = await createVolunteer();
    const alex = await createVolunteer('alex@example.com');
    await signup(shiftId, sam).expect(201);
    await signup(shiftId, alex).expect(409);
    const mine = await request(app).get('/shifts').query({ volunteerId: sam }).expect(200);
    expect(mine.body.shifts.map((shift: { _id: string }) => shift._id)).toEqual([shiftId]);
    await request(app).delete(`/shifts/${shiftId}/signups/${sam}`).expect(204);
    await request(app).delete(`/shifts/${shiftId}/signups/${sam}`).expect(204);
    await signup(shiftId, alex).expect(201);
    const canceled = await request(app).get('/shifts').query({ volunteerId: sam }).expect(200);
    expect(canceled.body.shifts).toEqual([]);
  });

  it('does not oversubscribe when twelve volunteers race for three spots', async () => {
    const shiftId = await createShift({ capacity: 3 });
    const volunteers = await Promise.all(Array.from({ length: 12 }, (_, i) => createVolunteer(`sam${i}@example.com`)));
    const responses = await Promise.all(volunteers.map(volunteerId => signup(shiftId, volunteerId)));
    expect(responses.filter(response => response.status === 201)).toHaveLength(3);
    expect(responses.filter(response => response.status === 409)).toHaveLength(9);
    const persisted = await Shift.findById(shiftId).orFail();
    expect(persisted.signups).toHaveLength(3);
  });

  it('stores only one signup when the same volunteer retries concurrently', async () => {
    const shiftId = await createShift({ capacity: 10 });
    const volunteerId = await createVolunteer();
    const responses = await Promise.all(Array.from({ length: 8 }, () => signup(shiftId, volunteerId)));
    expect(responses.filter(response => response.status === 201)).toHaveLength(1);
    expect(responses.filter(response => response.status === 409)).toHaveLength(7);
    expect((await Shift.findById(shiftId).orFail()).signups).toHaveLength(1);
  });

  it('rejects unknown volunteers and shifts', async () => {
    const shiftId = await createShift();
    await signup(shiftId, missingId).expect(404);
    const volunteerId = await createVolunteer();
    await signup(missingId, volunteerId).expect(404);
    await request(app).delete(`/shifts/${missingId}/signups/${volunteerId}`).expect(404);
  });

  it('rejects signups after a shift has started', async () => {
    const shiftId = await createShift({ startsAt: new Date(Date.now() - 1000).toISOString() });
    await signup(shiftId, await createVolunteer()).expect(409);
  });

  it('prevents deleting a populated shift or reducing capacity below its signup count', async () => {
    const shiftId = await createShift();
    const volunteers = await Promise.all([createVolunteer(), createVolunteer('alex@example.com')]);
    for (const volunteerId of volunteers) await signup(shiftId, volunteerId).expect(201);
    await request(app).patch(`/shifts/${shiftId}`).send({ capacity: 1 }).expect(409);
    await request(app).delete(`/shifts/${shiftId}`).expect(409);
    for (const volunteerId of volunteers) {
      await request(app).delete(`/shifts/${shiftId}/signups/${volunteerId}`).expect(204);
    }
    await request(app).delete(`/shifts/${shiftId}`).expect(204);
  });

  it('preserves capacity when an edit races with a signup', async () => {
    const shiftId = await createShift({ capacity: 2 });
    await signup(shiftId, await createVolunteer()).expect(201);
    const alex = await createVolunteer('alex@example.com');
    const responses = await Promise.all([
      request(app).patch(`/shifts/${shiftId}`).send({ capacity: 1 }),
      signup(shiftId, alex),
    ]);
    expect(responses.filter(response => response.status === 409)).toHaveLength(1);
    const persisted = await Shift.findById(shiftId).orFail();
    expect(persisted.signups.length).toBeLessThanOrEqual(persisted.capacity);
  });
});

describe('HTTP errors and health', () => {
  it('runs the documented demo through a listening HTTP server', async () => {
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const { stdout } = await promisify(execFile)(process.execPath, ['scripts/demo.mjs'], {
        env: { ...process.env, API_URL: `http://127.0.0.1:${port}` },
        timeout: 10000,
      });
      expect(stdout).toContain('Demo complete.');
      const shift = await Shift.findOne().orFail();
      expect(shift.signups).toHaveLength(1);
      const signedUp = await Volunteer.findById(shift.signups[0]!.volunteerId).orFail();
      expect(signedUp.name).toBe('Alex');
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it('reports a ready database', async () => {
    const response = await request(app).get('/health').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('returns consistent errors for malformed IDs, JSON, and unknown routes', async () => {
    const invalid = await request(app).get('/shifts/not-an-id').expect(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
    const malformed = await request(app).post('/shifts').set('Content-Type', 'application/json').send('{').expect(400);
    expect(malformed.body.error.code).toBe('INVALID_JSON');
    const unknown = await request(app).get('/missing').expect(404);
    expect(unknown.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects oversized request bodies', async () => {
    await request(app).post('/shifts').send({ description: 'x'.repeat(17000) }).expect(413);
  });
});
