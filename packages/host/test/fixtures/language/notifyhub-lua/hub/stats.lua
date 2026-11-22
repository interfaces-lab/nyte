---@class Counts
---@field submitted integer
---@field failed integer

---@class Stats
---@field total integer
---@field channels table<string, Counts>
local Stats = {}
Stats.__index = Stats

---@param channels table<string, Counts>
---@param name string
---@return Counts
local function bucket(channels, name)
  local counts = channels[name]
  if not counts then
    counts = { submitted = 0, failed = 0 }
    channels[name] = counts
  end
  return counts
end

---@return Stats
local function newStats()
  return setmetatable({ total = 0, channels = {} }, Stats)
end

---@param channel string
---@param ok boolean
function Stats:record(channel, ok)
  self.total = self.total + 1
  local counts = bucket(self.channels, channel)
  if ok then
    counts.submitted = counts.submitted + 1
  else
    counts.failed = counts.failed + 1
  end
end

---@return string[]
function Stats:names()
  local list = {}
  for name in pairs(self.channels) do
    list[#list + 1] = name
  end
  table.sort(list)
  return list
end

return {
  new = newStats,
}
