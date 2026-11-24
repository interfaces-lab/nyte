package notifyhub;

public interface Channel {
    String name();

    boolean send(Message message);
}
