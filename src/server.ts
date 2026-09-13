import mongoose from 'mongoose';
import { z } from 'zod';
import { app } from './app.js';
import { Shift, Volunteer } from './models.js';

const env = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/hackillinois-volunteers'),
}).parse(process.env);

try {
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  await Promise.all([Volunteer.init(), Shift.init()]);
  const server = app.listen(env.PORT, () => console.log(`Volunteer API listening on port ${env.PORT}`));
  server.on('error', error => {
    console.error('HTTP server failed:', error.message);
    void mongoose.disconnect().finally(() => process.exit(1));
  });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10000);
    deadline.unref();
    server.close(() => {
      void mongoose.disconnect().then(() => process.exit(0), () => process.exit(1));
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  console.error('Could not start API:', error instanceof Error ? error.message : error);
  await mongoose.disconnect();
  process.exitCode = 1;
}
