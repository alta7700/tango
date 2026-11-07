import type { BoardSize, CellValue, HintResult, Puzzle } from '../shared/types';
/** Управляет запросами к worker и пересоздаёт его после сбоя или тайм-аута. */
export class GameWorker {
  private worker?: Worker;
  private id = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private start() {
    if (this.worker) return;
    const worker = new Worker(new URL('../workers/game.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    worker.onmessage = ({ data }) => {
      const entry = this.pending.get(data.id); if (!entry) return;
      clearTimeout(entry.timer); this.pending.delete(data.id);
      if (data.error) entry.reject(new Error(data.error)); else entry.resolve(data.result);
    };
    worker.onerror = () => { if (this.worker === worker) this.fail('Ошибка фонового обработчика'); };
    worker.onmessageerror = () => { if (this.worker === worker) this.fail('Ошибка ответа фонового обработчика'); };
  }
  private fail(message: string) {
    this.worker?.terminate(); this.worker = undefined;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(message)); }
    this.pending.clear();
  }
  private call<T>(data: object): Promise<T> {
    this.start(); const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail('Превышено время ожидания'), 30000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      try { this.worker!.postMessage({ ...data, id }); } catch (error) {
        clearTimeout(timer); this.pending.delete(id);
        reject(error instanceof Error ? error : new Error('Не удалось отправить запрос'));
      }
    });
  }
  generate(size: BoardSize): Promise<Puzzle> { return this.call({ type: 'generate', size, seed: `${Date.now()}-${Math.random()}` }); }
  hint(puzzle: Puzzle, board: CellValue[]): Promise<HintResult> { return this.call({ type: 'hint', puzzle, board }); }
  dispose() { this.fail('Обработчик закрыт'); }
}
