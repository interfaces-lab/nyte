# frozen_string_literal: true

require_relative "channel"

module NotifyHub
  class Email < Channel
    attr_reader :address, :sent

    def initialize(address)
      @address = address
      @sent = []
    end

    def name
      "email"
    end

    def deliver(message)
      raise ArgumentError, "invalid email: #{@address}" unless @address.include?("@")

      @sent << message.subject
      true
    end
  end
end
