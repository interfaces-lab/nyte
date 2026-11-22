local stats = require("hub.stats")

---@class Message
---@field channel string
---@field recipient string
---@field body string

---@class Channel
---@field name string
---@field color string
---@field send fun(self: Channel, message: Message): boolean

---@class Hub
---@field channels table<string, Channel>
---@field ledger Stats
local Hub = {}
Hub.__index = Hub

---@return Hub
function Hub.new()
  return setmetatable({
    channels = {},
    ledger = stats.new(),
  }, Hub)
end

---@param channel Channel
function Hub:register(channel)
  self.channels[channel.name] = channel
end

---@param message Message
---@param strict boolean
---@return boolean
function Hub:submit(message, strict)
  local channel = self.channels[message.channel]
  if not channel then
    self.ledger:record(message.channel, false)
    return false
  end
  local ok = channel:send(message)
  if strict and not ok then
    self.ledger:record(channel.name, false)
    return false
  end
  self.ledger:record(channel.name, ok)
  return ok
end

---@return Stats
function Hub:stats()
  return self.ledger
end

return {
  Hub = Hub,
}
