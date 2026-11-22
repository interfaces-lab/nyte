# frozen_string_literal: true

module NotifyHub
  class Channel
    def name
      raise NotImplementedError
    end

    def deliver(message)
      raise NotImplementedError
    end
  end
end
