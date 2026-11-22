from dataclasses import dataclass
from typing import Protocol

from notifyhub.stats import Stats, new_stats


@dataclass(frozen=True)
class Message:
    channel: str
    subject: str
    body: str


class Channel(Protocol):
    def name(self) -> str: ...
    def send(self, message: Message) -> None: ...


class UnknownChannelError(LookupError):
    pass


class Hub:
    def __init__(self) -> None:
        self._channels: dict[str, Channel] = {}
        self._stats: Stats = new_stats()

    def register(self, channel: Channel) -> None:
        self._channels[channel.name()] = channel
        self._stats.track(channel.name())

    def submit(self, message: Message, dry_run: bool = False) -> None:
        channel = self._channels.get(message.channel)
        if channel is None:
            self._record("", False)
            raise UnknownChannelError(message.channel)
        if not dry_run:
            channel.send(message)
        self._record(channel.name(), True)

    def stats(self) -> Stats:
        return self._stats.clone()

    def _record(self, name: str, delivered: bool) -> None:
        self._stats.add(name, delivered)
