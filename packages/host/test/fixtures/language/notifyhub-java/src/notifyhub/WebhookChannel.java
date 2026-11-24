package notifyhub;

import java.util.ArrayList;
import java.util.List;

public final class WebhookChannel implements Channel {
    private final String endpoint;
    private final List<String> delivered = new ArrayList<>();

    public WebhookChannel(String endpoint) {
        this.endpoint = endpoint;
    }

    @Override
    public String name() {
        return "webhook";
    }

    @Override
    public boolean send(Message message) {
        if (!endpoint.startsWith("https://")) {
            return false;
        }
        delivered.add(message.subject());
        return true;
    }
}
