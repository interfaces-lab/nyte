package notifyhub;

import java.util.List;

public final class Main {
    public static void main(String[] args) {
        Hub hub = new Hub();
        hub.register(new EmailChannel("ops@example.com"));
        hub.register(new WebhookChannel("https://hooks.example.com/deploys"));

        List<Message> messages = List.of(
                new Message("email", "Deploy finished", "v1.8.2 is live."),
                new Message("webhook", "Deploy finished", "v1.8.2 is live."),
                new Message("pager", "Disk almost full", "92% on db-1."));

        for (Message message : messages) {
            hub.submit(message);
        }

        Stats stats = hub.stats();
        int   total=stats.total().submitted();
        System.out.printf(
                "%d submitted, %d delivered, %d failed%n",
                total, stats.total().delivered(), stats.total().failed());
        for (String name : stats.names()) {
            Stats.Counts counts = stats.channels().get(name);
            System.out.printf(
                    "  %-8s %d delivered, %d failed%n",
                    name, counts.delivered(), counts.failed());
        }
    }
}
