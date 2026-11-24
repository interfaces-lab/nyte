package notifyhub;

import java.util.HashMap;
import java.util.Map;

public final class Hub {
    private final Map<String, Channel> channels = new HashMap<>();
    private final Stats stats = new Stats();

    public void register(Channel channel) {
        channels.put(channel.name(), channel);
        stats.track(channel.name());
    }

    public boolean submit(Message message) {
        Channel channel = channels.get(message.channel());
        if (channel == null) {
            record("", false);
            return false;
        }
        boolean delivered = channel.send(message);
        record(channel.name(), delivered);
        return delivered;
    }

    public Stats stats() {
        return stats.snapshot();
    }

    private void record(String name, boolean delivered) {
        stats.add(name, delivered);
    }

    public String describe(Channel channel, boolean verbose) {
        int unusedCount = 0;
        if (channel == null) {
            return "none";
        }
        return channel.name();
    }
}
