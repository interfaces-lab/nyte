import { Email } from "./channels/email.ts";
import { Webhook } from "./channels/webhook.ts";
import { Hub, type Message } from "./hub.ts";
import { channelNames } from "./stats.ts";

const hub = new Hub();
hub.register(new Email("ops@example.com"));
hub.register(new Webhook("https://hooks.example.com/deploys"));

const messages: Message[] = [
  { channel: "email", subject: "Deploy finished", body: "v1.8.2 is live." },
  { channel: "webhook", subject: "Deploy finished", body: "v1.8.2 is live." },
  { channel: "pager", subject: "Disk almost full", body: "92% on db-1." },
];

const signal = AbortSignal.timeout(2000);
for (const message of messages) {
  try {
    await hub.submit(message, signal);
  } catch (error) {
    console.error("submit:", error instanceof Error ? error.message : error);
  }
}

const stats = hub.stats();
console.log(`${stats.total.submitted} submitted, ${stats.total.delivered} delivered, ${stats.total.failed} failed`);
for (const name of channelNames(stats)) {
  const counts = stats.channels[name];
  console.log(`  ${name.padEnd(8)} ${counts?.delivered ?? 0} delivered, ${counts?.failed ?? 0} failed`);
}
