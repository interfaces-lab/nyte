local hubMod = require("hub.hub")
local EmailChannel = require("hub.email")
local WebhookChannel = require("hub.webhook")

local hub = hubMod.Hub.new()
hub:register(EmailChannel.new("alerts@example.com"))
hub:register(WebhookChannel.new("https://hooks.example.com/notify"))

---@type Message
local message = {
  channel = "email",
  recipient = "ops@example.com",
  body = "Deploy finished",
}

hub:submit(message, true)
local   report=hub:stats()
local names = report:names()
return { total = report.total, names = names }
