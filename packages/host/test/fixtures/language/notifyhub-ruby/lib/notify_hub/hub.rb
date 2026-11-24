# frozen_string_literal: true

require_relative "channel"
require_relative "stats"

module NotifyHub
  class Message
    attr_reader :channel, :subject, :body

    def initialize(channel:, subject:, body:)
      @channel = channel
      @subject = subject
      @body = body
    end
  end

  class UnknownChannelError < StandardError; end

  # source://delegate//delegate.rb#1
  class Hub
    def initialize
      @channels = {}
      @stats = Stats.new
    end

    def register(channel)
      @channels[channel.name] = channel
      @stats.track(channel.name)
    end

    def submit(message, dry_run = false)
      channel = @channels[message.channel]
      unless channel
        @stats.add("", false)
        raise UnknownChannelError, "unknown channel: #{message.channel}"
      end

      ok = dry_run ? true : channel.deliver(message)
      @stats.add(channel.name, ok)
      ok
    rescue
      @stats.add(channel ? channel.name : "", false)
      false
    end

    def stats
      @stats
    end

    def describe(channel)
      unused_label = channel.name
      channel.class.name
    end

    def summary_pair(total, channels)
      { total:, channels: }
    end
  end
end
