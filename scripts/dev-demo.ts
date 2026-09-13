import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { z } from "zod";
import { app } from "../src/app.js";
import { Shift, Volunteer } from "../src/models.js";

const port = z.coerce
  .number()
  .int()
  .min(1)
  .max(65535)
  .default(3000)
  .parse(process.env.PORT);
const database = await MongoMemoryServer.create({
  binary: { version: "8.0.17" },
});
try {
  await mongoose.connect(database.getUri());
  await Promise.all([Volunteer.init(), Shift.init()]);
  const people = await Volunteer.create([
    { name: "Sam Rivera", email: "sam@example.com" },
    { name: "Alex Chen", email: "alex@example.com" },
    { name: "Jordan Patel", email: "jordan@example.com" },
  ]);
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(9, 0, 0, 0);
  const samples = [
    {
      title: "Welcome desk",
      location: "Siebel Center · Main lobby",
      description:
        "Hand out badges, point people in the right direction, and give every hacker a warm welcome.",
      hour: 0,
      capacity: 1,
      signups: [],
    },
    {
      title: "Lunch with the hackers",
      location: "Campus Instructional Facility",
      description:
        "Help set up lunch and keep the line moving. A friendly face goes a long way.",
      hour: 3,
      capacity: 4,
      signups: [{ volunteerId: people[2]!._id }],
    },
    {
      title: "Workshop support",
      location: "Siebel Center · Room 1404",
      description:
        "Welcome attendees, help speakers get settled, and keep the session on schedule.",
      hour: 5,
      capacity: 2,
      signups: [
        { volunteerId: people[0]!._id },
        { volunteerId: people[1]!._id },
      ],
    },
    {
      title: "Evening check-in",
      location: "Siebel Center · Main lobby",
      description:
        "Help late arrivals find their teams and make sure everyone has what they need.",
      hour: 9,
      capacity: 3,
      signups: [],
    },
    {
      title: "Project expo crew",
      location: "Campus Instructional Facility",
      description:
        "Get tables ready, guide visitors, and help the projects have their moment.",
      hour: 26,
      capacity: 5,
      signups: [{ volunteerId: people[2]!._id }],
    },
    {
      title: "The final sweep",
      location: "Siebel Center · All floors",
      description:
        "Pack supplies, collect signs, and leave the spaces ready for the next crew.",
      hour: 30,
      capacity: 4,
      signups: [],
    },
  ];
  await Shift.create(
    samples.map(({ hour, ...shift }) => ({
      ...shift,
      startsAt: new Date(start.getTime() + hour * 3600000),
      endsAt: new Date(start.getTime() + (hour + 2) * 3600000),
    })),
  );
  const server = app.listen(port, "127.0.0.1", () => {
    console.log(`Volunteer board: http://127.0.0.1:${port}`);
    console.log(
      "Sample data uses a temporary real MongoDB database. It resets when this process stops.",
    );
  });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    server.close(() => {
      void mongoose
        .disconnect()
        .then(() => database.stop())
        .finally(() => process.exit());
    });
  };
  server.on("error", (error) => {
    console.error(error.message);
    void mongoose
      .disconnect()
      .then(() => database.stop())
      .finally(() => process.exit(1));
  });
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (error) {
  await mongoose.disconnect();
  await database.stop();
  throw error;
}
