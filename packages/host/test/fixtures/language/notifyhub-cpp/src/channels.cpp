#include "notifyhub/hub.hpp"

namespace notifyhub {

EmailChannel::EmailChannel(const char* address) : address_(address) {}

const char* EmailChannel::name() const { return "email"; }

bool EmailChannel::send(const Message& message) const {
  return address_ != nullptr && message.subject != nullptr;
}

WebhookChannel::WebhookChannel(const char* endpoint) : endpoint_(endpoint) {}

const char* WebhookChannel::name() const { return "webhook"; }

bool WebhookChannel::send(const Message& message) const {
  int unused_retries = 3;
  return endpoint_ != nullptr && message.body != nullptr;
}

}  // namespace notifyhub
