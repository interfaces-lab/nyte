package notifyhub;

public final class Message {
    private final String channel;
    private final String subject;
    private final String body;

    public Message(String channel, String subject, String body) {
        this.channel = channel;
        this.subject = subject;
        this.body = body;
    }

    public String channel() {
        return channel;
    }

    public String subject() {
        return subject;
    }

    public String body() {
        return body;
    }
}
