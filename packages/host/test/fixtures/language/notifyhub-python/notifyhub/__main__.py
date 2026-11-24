from notifyhub.email import Email
from notifyhub.hub import Hub, Message, UnknownChannelError
from notifyhub.webhook import Webhook


def main() -> None:
    hub=Hub()
    hub.register(Email('ops@example.com'))
    hub.register(Webhook('https://hooks.example.com/deploys'))

    messages = [
        Message("email", "Deploy finished", "v1.8.2 is live."),
        Message("webhook", "Deploy finished", "v1.8.2 is live."),
        Message("pager", "Disk almost full", "92% on db-1."),
    ]
    for message in messages:
        try:
            hub.submit(message, False)
        except UnknownChannelError as error:
            print("submit:", error)

    stats = hub.stats()
    print(f"{stats.total.submitted} submitted, {stats.total.delivered} delivered, {stats.total.failed} failed")
    for name in stats.names():
        counts = stats.channels[name]
        print(f"  {name:<8} {counts.delivered} delivered, {counts.failed} failed")


if __name__ == "__main__":
    main()
