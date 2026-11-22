# frozen_string_literal: true

require_relative "channel"

module NotifyHub
  class Webhook < Channel
    attr_reader :endpoint, :attempts

    def initialize(endpoint)
      @endpoint = endpoint
      @attempts = 0
    end

    def name
      "webhook"
    end

    def deliver(message)
      @attempts += 1
      raise ArgumentError, "webhook must use https" unless @endpoint.start_with?("https://")

      !message.body.empty?
    end
  end
end
