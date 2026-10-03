import {
  marketBookStream,
  marketKlineStream,
  marketTradeStream
} from "@meridian/bus";
import { schemaVersion } from "@meridian/proto";
import type { NormalizedMarketEvent } from "./market-events.js";

export interface MarketEventPublisherDeps {
    readonly encode :(event:NormalizedMarketEvent) => Uint8Array;
    readonly xadd:(
        stream:string,
        id:"*",
        fields:{
            readonly schemaVersion :string;
            readonly kind:string;
            readonly symbol:string;
            readonly eventId:string;
            readonly occurredAtMs:string;
            readonly payload: Buffer;
        }
    )=>Promise<string>
}

export interface PublishedMarketEvents {
    readonly stream:string;
    readonly id:string;
}

export async function publishNormalizedMarketEvent(
    event:NormalizedMarketEvent,
    deps:MarketEventPublisherDeps
):Promise<PublishedMarketEvents>{
    const stream = streamForEvent(event);
    const payload = Buffer.from(deps.encode(event))

    const id = await deps.xadd(stream,'*',{
        schemaVersion,
    kind: event.kind,
    symbol: event.symbol,
    eventId: event.eventId,
    occurredAtMs: String(event.occurredAtMs),
    payload
    })
    return {stream, id};
}

function streamForEvent(event:NormalizedMarketEvent):string{
    switch(event.kind){
        case "trade":
      return marketTradeStream(event.symbol);
    case "kline":
      return marketKlineStream(event.symbol, event.candle.interval);
    case "depth":
      return marketBookStream(event.symbol);
    }
}