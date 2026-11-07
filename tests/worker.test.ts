import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameWorker } from '../src/app/worker';
import { generatePuzzle } from '../src/core';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
}
beforeEach(() => { vi.useFakeTimers(); FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('фоновый обработчик', () => {
  it('после сбоя создаёт новый worker и игнорирует старую ошибку', async () => {
    const rpc = new GameWorker(), firstRequest = rpc.generate(6), first = FakeWorker.instances[0];
    first.onerror!(); await expect(firstRequest).rejects.toThrow();
    const retry = rpc.generate(6), second = FakeWorker.instances[1];
    first.onerror!();
    expect(second.terminate).not.toHaveBeenCalled();
    second.onmessage!({ data: { id: 2, result: { id: 'новая' } } });
    await expect(retry).resolves.toEqual({ id: 'новая' });
    rpc.dispose();
  });
  it('повторяет подсказку в новом worker после ошибки загрузки', async () => {
    const puzzle = generatePuzzle({ size: 6, seed: 'повтор', maxAttempts: 1 });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rpc = new GameWorker(), request = rpc.hint(puzzle, [...puzzle.givens]);
    FakeWorker.instances[0].onerror!();
    await Promise.resolve();
    expect(FakeWorker.instances).toHaveLength(2);
    FakeWorker.instances[1].onmessage!({ data: { id: 2, result: { kind: 'stuck', message: 'Нет вывода' } } });
    await expect(request).resolves.toEqual({ kind: 'stuck', message: 'Нет вывода' });
    warning.mockRestore(); rpc.dispose();
  });
  it('останавливает зависший worker и позволяет повторить запрос', async () => {
    const rpc = new GameWorker(), request = rpc.generate(6);
    const rejected = expect(request).rejects.toThrow('Превышено время ожидания');
    await vi.advanceTimersByTimeAsync(30000); await rejected;
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    const retry = rpc.generate(8);
    FakeWorker.instances[1].onmessage!({ data: { id: 2, result: 'готово' } });
    await expect(retry).resolves.toBe('готово'); rpc.dispose();
  });
  it('очищает таймер после синхронной ошибки отправки', async () => {
    const rpc = new GameWorker(), first = rpc.generate(6);
    FakeWorker.instances[0].onmessage!({ data: { id: 1, result: 'готово' } }); await first;
    FakeWorker.instances[0].postMessage.mockImplementationOnce(() => { throw new Error('отправка'); });
    await expect(rpc.generate(6)).rejects.toThrow('отправка');
    expect(vi.getTimerCount()).toBe(0);
    const retry = rpc.generate(6);
    FakeWorker.instances[1].onmessage!({ data: { id: 3, result: 'повтор' } });
    await expect(retry).resolves.toBe('повтор'); rpc.dispose();
  });
});
