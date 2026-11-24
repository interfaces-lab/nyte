#include "notifyhub/checksum.h"
#include "notifyhub/hub.hpp"

int main() {
  notifyhub::Hub hub;
  notifyhub::EmailChannel email("ops@example.com");
  notifyhub::WebhookChannel webhook("https://hooks.example.com/deploys");
  hub.register_channel(&email);
  hub.register_channel(&webhook);

  notifyhub::Message alert{"email", "Deploy finished", "v1.8.2 is live."};
  hub.submit(alert, true);

  auto summary = hub.stats();
  unsigned int digest = notifyhub_checksum(alert.body, 15);
  int   total = summary.submitted + summary.delivered + (digest & 1u);
  return total > 0 ? 0 : 1;
}
