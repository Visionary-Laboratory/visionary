declare module 'mp4-muxer' {
  export class ArrayBufferTarget {
    constructor();
    buffer: ArrayBuffer;
  }

  export interface MuxerOptions<TTarget = ArrayBufferTarget> {
    target?: TTarget;
    video?: {
      codec: string;
      width: number;
      height: number;
    };
    audio?: any;
    fastStart?: 'in-memory' | 'auto';
  }

  export class Muxer<TTarget = ArrayBufferTarget> {
    constructor(options?: MuxerOptions<TTarget>);
    addVideoChunk(chunk: any, meta?: any): void;
    finalize(): Promise<void>;
    readonly target: TTarget;
  }
}

