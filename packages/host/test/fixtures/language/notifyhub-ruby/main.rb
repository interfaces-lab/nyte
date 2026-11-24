# frozen_string_literal: true

require_relative "lib/notify_hub/hub"
require_relative "lib/notify_hub/email"
require_relative "lib/notify_hub/webhook"

hub =   NotifyHub::Hub.new
hub.register(NotifyHub::Email.new("ops@example.com"))
hub.register(NotifyHub::Webhook.new("https://hooks.example.com/deploys"))

messages = [
  NotifyHub::Message.new(channel: "email", subject: "Deploy finished", body: "v1.8.2 is live."),
  NotifyHub::Message.new(channel: "webhook", subject: "Deploy finished", body: "v1.8.2 is live."),
  NotifyHub::Message.new(channel: "pager", subject: "Disk almost full", body: "92% on db-1.")
]

messages.each do |message|
  hub.submit(message, false)
end

stats = hub.stats
puts "#{stats.total.submitted} submitted, #{stats.total.delivered} delivered, #{stats.total.failed} failed"
stats.names.each do |name|
  counts = stats.channels[name]
  puts "  #{name}: #{counts.delivered} delivered, #{counts.failed} failed"
end
