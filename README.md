# Volunteer API

A volunteer shift signup API for the HackIllinois systems challenge. Built with TypeScript, Express, MongoDB, Mongoose, and Zod.

## Run locally

Requires Node.js 22+ and pnpm 10.33.0. Use Docker Compose for MongoDB, or point `MONGODB_URI` at an existing database.

```sh
pnpm install
cp .env.example .env
docker compose up -d
pnpm dev
```

The server listens on `http://localhost:3000`. In another terminal:

```sh
pnpm demo
```

The demo creates two volunteers and a one-person shift. It signs up the first volunteer, checks duplicate and full-shift rejections, cancels their signup, and gives the spot to the second volunteer. It uses fresh email addresses each run and leaves the records in the database for inspection. Set `API_URL` to use another server.

For compiled output, run `pnpm build` followed by `pnpm start`.

## Routes

Request bodies are JSON. IDs are MongoDB ObjectIds. Times must be ISO 8601 strings with a timezone, such as `2027-02-26T09:00:00-06:00`; responses use UTC.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/health` | Database connection readiness |
| POST | `/volunteers` | Register a volunteer with `name` and `email` |
| GET | `/volunteers/:id` | Retrieve a volunteer |
| POST | `/shifts` | Create a shift |
| GET | `/shifts` | List shifts in start-time order |
| GET | `/shifts/:id` | Retrieve a shift and its signups |
| PATCH | `/shifts/:id` | Update one or more shift fields |
| DELETE | `/shifts/:id` | Delete a shift with no signups |
| POST | `/shifts/:id/signups` | Sign up using `{ "volunteerId": "..." }` |
| DELETE | `/shifts/:id/signups/:volunteerId` | Cancel a signup |

Create a shift:

```sh
curl -i http://localhost:3000/shifts \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Check-in desk",
    "description": "Hand out badges and help attendees find their way.",
    "location": "Siebel Center lobby",
    "startsAt": "2027-02-26T09:00:00-06:00",
    "endsAt": "2027-02-26T11:00:00-06:00",
    "capacity": 4
  }'
```

`title`, `location`, `startsAt`, `endsAt`, and `capacity` are required. `description` is optional. Capacity is an integer from 1 to 500. Unknown body fields are rejected.

List filters are optional: `from` (inclusive start time), `to` (exclusive start time), and `volunteerId`. Pagination uses `limit` (default 20, maximum 100) and `offset` (default 0, maximum 10,000).

```sh
curl 'http://localhost:3000/shifts?limit=10&offset=0'
curl 'http://localhost:3000/shifts?volunteerId=VOLUNTEER_ID'
```

Single-resource responses use `{ "volunteer": {...} }` or `{ "shift": {...} }`. Lists use `{ "shifts": [...], "hasMore": true }`. Documents include `_id`, timestamps, and MongoDB's version field `__v`. Successful creation returns 201; deletion and cancellation return 204 without a body. Repeating a cancellation returns 204 as long as the shift exists.

Errors have one shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request",
    "details": [{ "field": "capacity", "message": "Too small: expected number to be >=1" }]
  }
}
```

`details` appears only for validation failures. Invalid input returns 400, missing resources return 404, and conflicts return 409. Conflict codes are `EMAIL_EXISTS`, `CAPACITY_TOO_LOW`, `SHIFT_CHANGED`, `SHIFT_HAS_SIGNUPS`, and `SIGNUP_UNAVAILABLE`. Oversized bodies return 413. A failed database connection reports 503 from `/health`.

## Data model and decisions

Volunteers live in their own collection, with a unique index on lowercase email addresses. Each shift holds its signup records: a volunteer ID and signup time. The 500-person limit bounds the array size.

Signup uses one conditional MongoDB update. It checks that the shift has not started, the volunteer is not already signed up, and the current signup count is below capacity before adding the signup. Those checks and the write are atomic, so concurrent requests cannot claim the same remaining spot. No separate counter needs to stay in sync.

Shift edits check the complete time range and current signup count, then compare the document version before writing. Signup, cancellation, and edits all increment that version. If a competing write wins, the edit returns `SHIFT_CHANGED`; the client can read the shift again and retry. A populated shift cannot be deleted. Cancellation remains available after a shift starts.

A rejected signup returns a single `SIGNUP_UNAVAILABLE` conflict for full, started, or duplicate signups. Another request may change the shift immediately after rejection, so a second read would not reliably explain why the atomic update failed.

Authentication is outside this challenge's scope: anyone who can reach the API can manage shifts and signups. This is intended for local development and demos. Overlapping shifts are allowed; preventing conflicts across multiple shifts would need a separate concurrency strategy. There is no waitlist, notification service, or volunteer deletion endpoint. Schedule edits preserve existing signups, so organizers are responsible for communicating time or location changes.

## Checks

```sh
pnpm typecheck
pnpm build
pnpm test
```

Tests use Supertest against Express and a temporary real MongoDB process through `mongodb-memory-server`. They do not use your configured database or require Docker. The first test run downloads a MongoDB binary and requires internet access.

Coverage includes validation, email uniqueness, pagination and date filters, signup cancellation, started shifts, missing records, and concurrent requests for limited spots. Tests also race duplicate signups and capacity edits against signups. GitHub Actions runs the same checks.

## References

- [Express routing](https://expressjs.com/en/guide/routing.html)
- [Mongoose `findOneAndUpdate`](https://mongoosejs.com/docs/tutorials/findoneandupdate.html)
- [MongoDB atomicity](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/)
- [Zod validation](https://zod.dev/api)
