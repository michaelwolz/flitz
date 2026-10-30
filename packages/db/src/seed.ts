import { connectDb, links } from "./index.ts";

const slug = "x7k4m9p";

const db = await connectDb(process.env.DATABASE_URL!);
await db.insert(links).values({ slug, defaultTarget: "https://example.com/?utm_source=flitz&lang=en" }).onConflictDoNothing();
await db.$client.end();
console.log(`Seeded Link with Slug "${slug}"`);
