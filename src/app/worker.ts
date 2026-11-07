import { getHint } from '../hints';
import type { BoardSize, CellValue, HintResult, Puzzle } from '../shared/types';

// Отличаем отказ транспорта от ошибки самого вычисления, которую нельзя скрывать повтором.
class WorkerTransportError extends Error {}

/** Управляет запросами к worker и восстанавливает вычисление подсказки при его недоступности. */
export class GameWorker {
  private worker?: Worker;
  private disposed = false;
  private id = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private start() {
    if (this.disposed) throw new Error('Обработчик закрыт');
    if (this.worker) return;
    let worker: Worker;
    try { worker = new Worker(new URL('../workers/game.ts', import.meta.url), { type: 'module' }); }
    catch { throw new WorkerTransportError('Не удалось запустить фоновый обработчик'); }
    this.worker = worker;
    worker.onmessage = ({ data }) => {
      const entry = this.pending.get(data.id); if (!entry) return;
      clearTimeout(entry.timer); this.pending.delete(data.id);
      if (data.error) entry.reject(new Error(data.error)); else entry.resolve(data.result);
    };
    worker.onerror = () => { if (this.worker === worker) this.fail(new WorkerTransportError('Ошибка фонового обработчика')); };
    worker.onmessageerror = () => { if (this.worker === worker) this.fail(new WorkerTransportError('Ошибка ответа фонового обработчика')); };
  }
  private fail(error: Error) {
    this.worker?.terminate(); this.worker = undefined;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
  }
  private call<T>(data: object): Promise<T> {
    this.start(); const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new WorkerTransportError('Превышено время ожидания')), 30000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      try { this.worker!.postMessage({ ...data, id }); } catch (error) {
        this.fail(new WorkerTransportError(error instanceof Error ? error.message : 'Не удалось отправить запрос'));
      }
    });
  }
  generate(size: BoardSize): Promise<Puzzle> { return this.call({ type: 'generate', size, seed: `${Date.now()}-${Math.random()}` }); }
  async hint(puzzle: Puzzle, board: CellValue[]): Promise<HintResult> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return await this.call({ type: 'hint', puzzle, board }); }
      catch (error) {
        if (!(error instanceof WorkerTransportError) || this.disposed) {
          if (!this.disposed) console.error('Ошибка вычисления подсказки', { reason: error instanceof Error ? error.message : 'Неизвестная ошибка' });
          throw error;
        }
        console.warn('Не удалось получить подсказку в worker', { attempt: attempt + 1, reason: error.message });
      }
    }
    // Код уже загружен вместе со страницей; небольшой бюджет ограничивает работу в главном потоке.
    return getHint(puzzle, board, { maxNodes: 32 });
  }
  dispose() { this.disposed = true; this.fail(new Error('Обработчик закрыт')); }
}
