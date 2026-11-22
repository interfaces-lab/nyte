#pragma once

namespace notifyhub {

struct Message {
  const char* channel;
  const char* subject;
  const char* body;
};

struct Counts {
  int submitted;
  int delivered;
  int failed;
};

class Channel {
 public:
  virtual ~Channel() = default;
  virtual const char* name() const = 0;
  virtual bool send(const Message& message) const = 0;
};

class EmailChannel : public Channel {
 public:
  explicit EmailChannel(const char* address);
  const char* name() const override;
  bool send(const Message& message) const override;

 private:
  const char* address_;
};

class WebhookChannel : public Channel {
 public:
  explicit WebhookChannel(const char* endpoint);
  const char* name() const override;
  bool send(const Message& message) const override;

 private:
  const char* endpoint_;
};

class Hub {
 public:
  Hub();
  void register_channel(const Channel* channel);
  bool submit(const Message& message, bool urgent);
  Counts stats() const;

 private:
  void record(bool delivered);

  static constexpr int kMaxChannels = 8;
  const Channel* channels_[kMaxChannels];
  int channel_count_;
  Counts totals_;
};

Counts bump_counts(Counts counts, bool delivered);

}  // namespace notifyhub
