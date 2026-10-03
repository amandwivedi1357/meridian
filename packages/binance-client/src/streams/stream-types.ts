export type StreamConnectionState = | 'IDLE'
                                   | 'CONNECTING'
                                   | 'OPEN'
                                   | 'STALE'
                                   | 'CLOSING'
                                   | 'BACKOFF'

export interface StreamSubscription {
    readonly streamName:string;
}

export interface StreamConnectionEvent{
    readonly state: StreamConnectionState;
    readonly timestampMs:number;
    readonly reason?:string;
}

export interface StreamMessage<TPayload = unknown>{
    readonly stream:string;
    readonly data: TPayload;
}

