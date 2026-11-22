from dataclasses import dataclass, field


@dataclass
class Counts:
    submitted: int = 0
    delivered: int = 0
    failed: int = 0


@dataclass
class Stats:
    total: Counts = field(default_factory=Counts)
    channels: dict[str, Counts] = field(default_factory=dict)

    def names(self) -> list[str]:
        return sorted(self.channels)

    def track(self, name: str) -> None:
        if name not in self.channels:
            self.channels[name] = Counts()

    def add(self, name: str, delivered: bool) -> None:
        self.total = bump(self.total, delivered)
        if not name:
            return
        self.channels[name] = bump(self.channels[name], delivered)

    def clone(self) -> "Stats":
        channels = {
            name: Counts(c.submitted, c.delivered, c.failed)
            for name, c in self.channels.items()
        }
        return Stats(
            total=Counts(self.total.submitted, self.total.delivered, self.total.failed),
            channels=channels,
        )


def new_stats() -> Stats:
    return Stats()


def bump(counts: Counts, delivered: bool) -> Counts:
    return Counts(
        submitted=counts.submitted + 1,
        delivered=counts.delivered + (1 if delivered else 0),
        failed=counts.failed + (0 if delivered else 1),
    )
