---@class EmailChannel : Channel
---@field sender string
local EmailChannel = {}
EmailChannel.__index = EmailChannel

---@param sender string
---@return Channel
function EmailChannel.new(sender)
  ---@type Channel
  local channel = {
    name = "email",
    color = "#2563eb",
    send = function(self, message)
      return sender ~= "" and self.name ~= "" and message.recipient ~= "" and message.body ~= ""
    end,
  }
  return channel
end

return EmailChannel
