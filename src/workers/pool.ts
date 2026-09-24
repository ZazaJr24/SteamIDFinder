/** A small pool of identical workers with request/response promises. */

interface Pending<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  worker: number;
}

export class WorkerPool<Req extends object, Res> {
  private readonly workers: Worker[] = [];
  private readonly busy: number[] = [];
  private readonly pending = new Map<number, Pending<Res>>();
  private nextId = 1;

  constructor(factory: () => Worker, size: number) {
    for (let i = 0; i < size; i++) {
      const w = factory();
      const index = i;
      w.onmessage = (e: MessageEvent<{ id: number; error?: string } & Res>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        this.busy[index]!--;
        if (e.data.error) p.reject(new Error(e.data.error));
        else p.resolve(e.data);
      };
      w.onerror = (e) => {
        console.error('[worker]', e.message);
      };
      this.workers.push(w);
      this.busy.push(0);
    }
  }

  get size(): number {
    return this.workers.length;
  }

  /** Jobs currently in flight across all workers. */
  get inFlight(): number {
    return this.pending.size;
  }

  /** Sends the same message to every worker (e.g. init). */
  broadcast(message: object): void {
    for (const w of this.workers) w.postMessage(message);
  }

  request(message: Req, transfer: Transferable[] = []): Promise<Res> {
    let best = 0;
    for (let i = 1; i < this.workers.length; i++) if (this.busy[i]! < this.busy[best]!) best = i;
    const id = this.nextId++;
    this.busy[best]!++;
    return new Promise<Res>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, worker: best });
      this.workers[best]!.postMessage({ ...message, id }, transfer);
    });
  }

  terminate(): void {
    for (const w of this.workers) w.terminate();
    for (const p of this.pending.values()) p.reject(new Error('pool terminated'));
    this.pending.clear();
  }
}

export function defaultWorkerCount(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  return Math.max(1, Math.min(4, cores - 1));
}
