from notifyhub.hub import Channel, Message


class Email(Channel):
    def __init__(self, address: str) -> None:
        self.address = address
        self.sent: list[str] = []

    def name(self) -> str:
        return "email"

    def send(self, message: Message) -> None:
        if "@" not in self.address:
            raise ValueError(f"email: {self.address!r} is not an address")
        self.sent.append(message.subject)
