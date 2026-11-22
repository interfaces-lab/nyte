import json
import sys  # noqa: F401
from urllib.parse import urlparse

from notifyhub.hub import Channel, Message


class Webhook(Channel):
    def __init__(self, endpoint: str) -> None:
        self.endpoint = endpoint
        self.attempts = 0

    def name(self) -> str:
        return "webhook"

    def send(self, message: Message) -> None:
        self.attempts += 1
        target = urlparse(self.endpoint)
        if target.scheme != "https":
            raise ValueError(f"webhook: {target.netloc} is not https")
        retries: int = "3"
        if self.attempts > retries:
            raise RuntimeError(message.subject)
