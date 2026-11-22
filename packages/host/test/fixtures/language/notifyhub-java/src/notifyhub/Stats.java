package notifyhub;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class Stats {
    public static final class Counts {
        private final int submitted;
        private final int delivered;
        private final int failed;

        public Counts(int submitted, int delivered, int failed) {
            this.submitted = submitted;
            this.delivered = delivered;
            this.failed = failed;
        }

        public int submitted() {
            return submitted;
        }

        public int delivered() {
            return delivered;
        }

        public int failed() {
            return failed;
        }
    }

    private Counts total = new Counts(0, 0, 0);
    private final Map<String, Counts> channels = new HashMap<>();

    public Counts total() {
        return total;
    }

    public Map<String, Counts> channels() {
        return new HashMap<>(channels);
    }

    public List<String> names() {
        List<String> names = new ArrayList<>(channels.keySet());
        Collections.sort(names);
        return names;
    }

    void track(String name) {
        channels.putIfAbsent(name, new Counts(0, 0, 0));
    }

    void add(String name, boolean delivered) {
        total = bump(total, delivered);
        if (name.isEmpty()) {
            return;
        }
        Counts current = channels.getOrDefault(name, new Counts(0, 0, 0));
        channels.put(name, bump(current, delivered));
    }

    Stats snapshot() {
        Stats copy = new Stats();
        copy.total = total;
        copy.channels.putAll(channels);
        return copy;
    }

    private static Counts bump(Counts counts, boolean delivered) {
        return new Counts(
                counts.submitted() + 1,
                counts.delivered() + (delivered ? 1 : 0),
                counts.failed() + (delivered ? 0 : 1));
    }
}
