package notifyhub;

import java.util.ArrayList;
import java.util.List;

public final class EmailChannel implements Channel {
    private final String address;
    private final List<String> sent = new ArrayList<>();

    public EmailChannel(String address) {
        this.address = address;
    }

    @Override
    public String name() {
        return "email";
    }

    @Override
    public boolean send(Message message) {
        if (!address.contains("@")) {
            return false;
        }
        sent.add(message.subject());
        return true;
    }

    public int sentCount() {
        return sent.size();
    }
}
