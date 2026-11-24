# frozen_string_literal: true

module NotifyHub
  class Counts
    attr_reader :submitted, :delivered, :failed

    def initialize(submitted: 0, delivered: 0, failed: 0)
      @submitted = submitted
      @delivered = delivered
      @failed = failed
    end

    def bump(ok)
      Counts.new(
        submitted: @submitted + 1,
        delivered: @delivered + (ok ? 1 : 0),
        failed: @failed + (ok ? 0 : 1)
      )
    end
  end

  class Stats
    attr_reader :total, :channels

    def initialize
      @total = Counts.new
      @channels = {}
    end

    def names
      @channels.keys.sort
    end

    def track(name)
      @channels[name] ||= Counts.new
    end

    def add(name, ok)
      @total = @total.bump(ok)
      return if name.empty?

      @channels[name] = track(name).bump(ok)
    end

    def snapshot
      { total: @total, channels: @channels.dup }
    end
  end
end
