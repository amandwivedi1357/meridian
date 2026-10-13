export const marketDemandKey = "meridian:dashboard:market-demand";
export const readMarketDemandScript =
  "local t=redis.call('TIME') local n=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000) redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',n) return redis.call('ZRANGE',KEYS[1],0,599)";
export const marketDemandScript = `
local time=redis.call('TIME')
local now=tonumber(time[1])*1000+math.floor(tonumber(time[2])/1000)
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now)
local members=redis.call('ZRANGE',KEYS[1],0,-1)
local symbols={} local count=0 local known=false
for _,member in ipairs(members) do
  local symbol=string.match(member,'|(.+)$')
  if symbol and not symbols[symbol] then symbols[symbol]=true count=count+1 end
  if member==ARGV[1] then known=true end
end
if not known and (#members>=600 or (not symbols[ARGV[2]] and count>=3)) then return 0 end
redis.call('ZADD',KEYS[1],now+45000,ARGV[1])
redis.call('EXPIRE',KEYS[1],90)
return 1`;

export function demandedMarketSymbols(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 600) throw new Error("invalid_market_demand");
  const symbols = new Set(["BTCUSDT"]);
  for (const member of value) {
    if (typeof member !== "string" || !/^[a-f0-9-]{36}\|[A-Z0-9]{3,30}$/.test(member))
      throw new Error("invalid_market_demand");
    symbols.add(member.split("|")[1]!);
  }
  if (symbols.size > 4) throw new Error("market_feed_capacity");
  return [...symbols];
}
