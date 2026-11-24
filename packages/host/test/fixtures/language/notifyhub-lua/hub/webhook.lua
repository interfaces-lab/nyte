---@class WebhookChannel : Channel
---@field endpoint string
local WebhookChannel = {}
WebhookChannel.__index = WebhookChannel

---@param endpoint string
---@return Channel
function WebhookChannel.new(endpoint)
  ---@type Channel
  local channel = {
    name = "webhook",
    color = "#16a34a",
    send = function(self, message)
      ---@type integer
      local retries = "three"
      local audit = missingAuditHook(message, retries)
      return endpoint ~= "" and self.name ~= "" and audit ~= nil
    end,
  }
  return channel
end

return WebhookChannel
