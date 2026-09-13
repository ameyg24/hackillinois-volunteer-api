const baseUrl = process.env.API_URL ?? 'http://localhost:3000';

async function call(method, path, body, expected = 200) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = response.status === 204 ? undefined : await response.json();
  console.log(`${method} ${path} → ${response.status}`);
  if (response.status !== expected) throw new Error(JSON.stringify(result));
  return result;
}

const suffix = crypto.randomUUID();
const { volunteer: sam } = await call('POST', '/volunteers', {
  name: 'Sam', email: `sam-${suffix}@example.com`,
}, 201);
const { volunteer: alex } = await call('POST', '/volunteers', {
  name: 'Alex', email: `alex-${suffix}@example.com`,
}, 201);
const { shift } = await call('POST', '/shifts', {
  title: 'Check-in desk', location: 'Siebel Center lobby', capacity: 1,
  startsAt: new Date(Date.now() + 86400000).toISOString(),
  endsAt: new Date(Date.now() + 90000000).toISOString(),
}, 201);

await call('POST', `/shifts/${shift._id}/signups`, { volunteerId: sam._id }, 201);
await call('POST', `/shifts/${shift._id}/signups`, { volunteerId: sam._id }, 409);
await call('POST', `/shifts/${shift._id}/signups`, { volunteerId: alex._id }, 409);
await call('DELETE', `/shifts/${shift._id}/signups/${sam._id}`, undefined, 204);
await call('POST', `/shifts/${shift._id}/signups`, { volunteerId: alex._id }, 201);
const result = await call('GET', `/shifts?volunteerId=${alex._id}`);
console.log(JSON.stringify(result, null, 2));
console.log('Demo complete. The shift and volunteers remain available for inspection.');
