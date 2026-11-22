#include "notifyhub/hub.hpp"

namespace notifyhub {

namespace {

bool names_equal(const char* left, const char* right) {
  if (left == nullptr || right == nullptr) {
    return false;
  }
  while (*left != '\0' && *right != '\0') {
    if (*left != *right) {
      return false;
    }
    ++left;
    ++right;
  }
  return *left == *right;
}

}  // namespace

Counts bump_counts(Counts counts, bool delivered) {
  counts.submitted += 1;
  if (delivered) {
    counts.delivered += 1;
  } else {
    counts.failed += 1;
  }
  return counts;
}

Hub::Hub() : channels_{}, channel_count_(0), totals_{0, 0, 0} {}

void Hub::register_channel(const Channel* channel) {
  if (channel == nullptr || channel_count_ >= kMaxChannels) {
    return;
  }
  channels_[channel_count_] = channel;
  channel_count_ += 1;
}

bool Hub::submit(const Message& message, bool urgent) {
  for (int i = 0; i < channel_count_; ++i) {
    const Channel* candidate = channels_[i];
    if (names_equal(candidate->name(), message.channel)) {
      bool delivered = candidate->send(message);
      record(delivered);
      return delivered && urgent;
    }
  }
  record(false);
  return false;
}

Counts Hub::stats() const { return totals_; }

void Hub::record(bool delivered) { totals_ = bump_counts(totals_, delivered); }

}  // namespace notifyhub
