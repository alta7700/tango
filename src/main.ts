import './style.css';
import { validateBoard } from './core';
import { createGameContainer } from './platform';
import { move, newState, reset, restore, undo, type GameState } from './app/state';
import { GameWorker } from './app/worker';
import type { BoardSize, CellValue, HintResult } from './shared/types';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Не найден контейнер приложения');
const platform = import.meta.env.VITE_GAME_PLATFORM === 'yandex' ? 'yandex' : 'standalone';
const container = createGameContainer(platform);
const worker = new GameWorker();
const saveKey = `tango:${platform}:game:v1`, countKey = `tango:${platform}:count:v1`;
let state: GameState | null = null, count = 0, busy = false, paused = false, active = false, version = 0;
let hint: HintResult | null = null, notice = '', zoom = false, lastTick = performance.now();
let suspended = false, disposed = false, focusAfterPause: number | undefined;
try { state = restore(localStorage.getItem(saveKey)); const n = Number(localStorage.getItem(countKey)); if (Number.isSafeInteger(n) && n >= 0) count = n; } catch { /* Хранилище может быть недоступно. */ }
if (state) count = Math.max(count, state.number);
const root = app;
root.innerHTML = `<div class="shell"><header><div class="brand"><span class="brand-mark">✳</span><div><h1>Tango</h1><p>Солнце и луна в равновесии</p></div></div><div class="controls"><label for="size">Размер поля</label><select id="size"><option value="6">6 × 6</option><option value="8">8 × 8</option><option value="10">10 × 10</option></select><button id="new" class="primary">Новая игра</button></div></header><main><div class="game-heading"><div><span class="eyebrow">ВАША ПАРТИЯ</span><h2>Найдите баланс</h2></div><div class="stats"><div><span>ВРЕМЯ</span><strong id="timer">00:00</strong></div><div><span>ЗАПОЛНЕНО</span><strong id="progress">—</strong></div></div></div><div id="status" class="status" aria-live="polite"></div><div class="board-tools"><button id="zoom" class="text-button" hidden>Увеличить поле</button></div><div class="board-scroll"><div id="board" class="board" role="grid" aria-label="Игровое поле"></div></div><div class="actions"><button id="undo">↶ <span>Отменить</span></button><button id="reset">↺ <span>Сбросить</span></button><button id="hint" class="hint-button">✦ <span>Подсказка</span></button></div><section id="hint-panel" class="hint-panel" hidden aria-live="polite"></section><section id="victory" class="victory" hidden aria-live="polite"></section><details class="rules"><summary>Как играть</summary><div><p>Заполните поле солнцами и лунами. Нажимайте на пустую клетку, чтобы менять символ.</p><ul><li>В каждой строке и каждом столбце солнц и лун поровну.</li><li>Три одинаковых символа не могут стоять подряд.</li><li>Знак = означает одинаковые символы, × — разные.</li></ul><p>Клетки с заливкой заданы в начале. Стрелки перемещают фокус, Enter или пробел меняют символ, Delete очищает клетку.</p></div></details></main><footer>Немного логики — и всё на своих местах.</footer></div>`;
const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
const size = $<HTMLSelectElement>('#size'), board = $('#board'), timer = $('#timer'), progress = $('#progress'), status = $('#status'), panel = $('#hint-panel'), victory = $('#victory');
if (state) size.value = String(state.puzzle.size);
const symbols: Record<Exclude<CellValue, null>, string> = { sun: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="7"/><path d="M16 2v4M16 26v4M2 16h4M26 16h4M6 6l3 3M23 23l3 3M26 6l-3 3M9 23l-3 3"/></svg>', moon: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M23 26A12 12 0 0 1 14 3a11 11 0 0 0 9 23Z"/></svg>' };
const valueName = (v: CellValue) => v === 'sun' ? 'солнце' : v === 'moon' ? 'луна' : 'пусто';
function save() { if (!state) return; try { localStorage.setItem(saveKey, JSON.stringify({ version: 1, state })); localStorage.setItem(countKey, String(count)); } catch { /* Игра продолжается без сохранения. */ } }
// Сначала фиксируем прошедшее время, прежде чем менять состояние или режим игры.
function syncTime() {
  const now = performance.now(); if (active && state) state.elapsed += Math.max(0, now - lastTick); lastTick = now;
}
function syncActivity() {
  syncTime(); const next = !!state && !busy && !paused && !suspended && !disposed && !validateBoard(state.puzzle, state.board).complete;
  if (next !== active) { active = next; if (active) container.gameplayStart(); else container.gameplayStop(); }
}
function timeText(ms: number) { const seconds = Math.floor(ms / 1000); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function updateClock() { syncTime(); timer.textContent = timeText(state?.elapsed ?? 0); }
function render(focus?: number) {
  syncActivity();
  const focusedCell = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLButtonElement>('.cell') : null;
  const focusedIndex = focusedCell && board.contains(focusedCell) ? Number(focusedCell.dataset.index) : undefined;
  const locked = busy || paused || suspended || !state;
  if (locked && focusedIndex !== undefined) focusAfterPause = focusedIndex;
  $<HTMLButtonElement>('#new').disabled = busy || paused;
  size.disabled = busy || paused;
  $<HTMLButtonElement>('#undo').disabled = locked || !state?.history.length;
  $<HTMLButtonElement>('#reset').disabled = locked;
  const hintButton = $<HTMLButtonElement>('#hint');
  hintButton.disabled = locked;
  hintButton.querySelector('span')!.textContent = hint ? 'Подсказка открыта' : platform === 'yandex' ? 'Подсказка за видео' : 'Подсказка';
  const zoomButton = $<HTMLButtonElement>('#zoom'); zoomButton.hidden = state?.puzzle.size !== 10; zoomButton.textContent = zoom ? 'Уместить поле' : 'Увеличить поле';
  board.classList.toggle('zoomed', zoom && state?.puzzle.size === 10);
  if (!state) { board.innerHTML = `<div class="loading">${busy ? 'Готовим поле…' : 'Нет активной партии. Нажмите «Новая игра».'}</div>`; status.textContent = notice || (busy ? 'Создаём новую задачу…' : 'Не удалось создать задачу. Попробуйте ещё раз.'); return; }
  const { puzzle, board: values } = state, validation = validateBoard(puzzle, values);
  const conflicts = new Set(validation.conflicts.flatMap(c => c.cells));
  const related = new Set(hint && 'relatedCells' in hint ? hint.relatedCells : []);
  const relatedRelations = new Set(hint?.kind === 'step' ? hint.relatedRelations ?? [] : []);
  progress.textContent = `${values.filter(v => v !== null).length} / ${values.length}`;
  status.textContent = paused ? 'Игра на паузе' : busy ? 'Подождите немного…' : notice || (validation.conflicts[0]?.message ?? '');
  board.style.setProperty('--size', String(puzzle.size)); board.innerHTML = '';
  board.setAttribute('aria-rowcount', String(puzzle.size)); board.setAttribute('aria-colcount', String(puzzle.size));
  // Строки сохраняют семантику таблицы, а массив клеток — индексацию связей.
  const rows = Array.from({ length: puzzle.size }, (_, i) => {
    const row = document.createElement('div'); row.className = 'board-row'; row.setAttribute('role', 'row'); row.setAttribute('aria-rowindex', String(i + 1)); board.append(row); return row;
  });
  const cells: HTMLButtonElement[] = [];
  values.forEach((value, i) => {
    const cell = document.createElement('button'); cell.type = 'button'; cell.className = `cell ${value ?? ''}${puzzle.givens[i] !== null ? ' given' : ''}${conflicts.has(i) ? ' conflict' : ''}${related.has(i) ? ' related' : ''}`;
    cell.dataset.index = String(i); cell.setAttribute('role', 'gridcell'); cell.setAttribute('aria-colindex', String(i % puzzle.size + 1)); cell.setAttribute('aria-label', `Строка ${Math.floor(i / puzzle.size) + 1}, столбец ${i % puzzle.size + 1}: ${valueName(value)}${puzzle.givens[i] !== null ? ', задано' : ''}`);
    cell.disabled = locked || validation.complete; cell.innerHTML = value ? symbols[value] : '';
    rows[Math.floor(i / puzzle.size)].append(cell); cells.push(cell);
  });
  puzzle.relations.forEach((relation, index) => {
    const a = Math.min(relation.a, relation.b), b = Math.max(relation.a, relation.b), cell = cells[a];
    const marker = document.createElement('span'); marker.className = `relation ${b - a === 1 ? 'horizontal' : 'vertical'}${relatedRelations.has(index) ? ' highlighted' : ''}`; marker.textContent = relation.type === 'equal' ? '=' : '×'; marker.setAttribute('aria-hidden', 'true'); cell.append(marker);
  });
  panel.hidden = !hint; panel.innerHTML = '';
  if (hint) {
    const title = document.createElement('strong'); title.textContent = hint.kind === 'step' ? 'Есть идея' : 'Подсказка'; panel.append(title);
    const text = document.createElement('p'); text.textContent = hint.message; panel.append(text);
    if (hint.kind === 'step') {
      if (hint.details?.length) { const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Почему так?'; details.append(summary); hint.details.forEach(item => { const p = document.createElement('p'); p.textContent = item; details.append(p); }); panel.append(details); }
      const apply = document.createElement('button'); apply.id = 'apply-hint'; apply.className = 'primary'; apply.textContent = 'Применить'; apply.disabled = locked; apply.onclick = () => { if (hint?.kind === 'step') change(hint.index, hint.value); }; panel.append(apply);
    }
  }
  victory.hidden = !validation.complete;
  if (validation.complete) { victory.innerHTML = `<strong>Отличная работа!</strong><p>Поле ${puzzle.size} × ${puzzle.size} решено за ${timeText(state.elapsed)}.</p><button class="primary" id="victory-new">Новая игра</button>`; $('#victory-new').onclick = startFromClick; }
  const targetFocus = focus ?? focusedIndex ?? (!locked ? focusAfterPause : undefined);
  if (!locked && targetFocus !== undefined) { board.querySelector<HTMLButtonElement>(`[data-index="${targetFocus}"]`)?.focus(); focusAfterPause = undefined; }
}
function change(index: number, value: CellValue) {
  if (!state || busy || paused || validateBoard(state.puzzle, state.board).complete) return;
  syncTime();
  const next = move(state, index, value); if (next === state) return;
  state = next; version++; hint = null; notice = ''; save(); render(index);
}
async function startGame() {
  if (busy || paused) return;
  // Версия не позволяет устаревшему асинхронному результату заменить другую партию.
  busy = true; const requestVersion = ++version; hint = null; notice = ''; render();
  try {
    const nextNumber = count + 1;
    const puzzle = await worker.generate(Number(size.value) as BoardSize);
    if (disposed || requestVersion !== version) return;
    // Рекламу показываем только после успешной подготовки следующей задачи.
    if (nextNumber % 3 === 0) { try { await container.showInterstitial(); } catch { /* Ошибка рекламы не препятствует игре. */ } }
    if (disposed || requestVersion !== version) return;
    state = newState(puzzle, nextNumber); count = nextNumber; zoom = false; save();
  } catch { if (!disposed) notice = 'Не удалось создать задачу. Попробуйте ещё раз.'; }
  finally { if (!disposed) { busy = false; render(); } }
}
async function requestHint() {
  if (!state || busy || paused || hint) return;
  const requestVersion = version, current = state; busy = true; notice = ''; render();
  try {
    const result = await worker.hint(current.puzzle, [...current.board]);
    if (requestVersion !== version) return;
    if (result.kind === 'step') {
      let granted = true;
      try { const reward = await container.requestHintReward(); granted = reward.granted || reward.reason === 'unavailable' || reward.reason === 'error'; } catch { /* При ошибке подсказка бесплатна. */ }
      if (requestVersion !== version) return;
      if (!granted) { notice = 'Просмотр не завершён. Подсказка пока не открыта.'; return; }
    }
    hint = result;
  } catch { if (!disposed) notice = 'Не удалось получить подсказку. Попробуйте ещё раз.'; }
  finally { if (!disposed) { busy = false; render(); } }
}
board.addEventListener('click', e => { const cell = (e.target as HTMLElement).closest<HTMLButtonElement>('.cell'); if (!cell || !state) return; const index = Number(cell.dataset.index), value = state.board[index]; change(index, value === null ? 'sun' : value === 'sun' ? 'moon' : null); });
board.addEventListener('keydown', e => {
  const cell = (e.target as HTMLElement).closest<HTMLButtonElement>('.cell'); if (!cell || !state) return;
  const i = Number(cell.dataset.index), n = state.puzzle.size;
  const target = e.key === 'ArrowLeft' && i % n ? i - 1 : e.key === 'ArrowRight' && i % n < n - 1 ? i + 1 : e.key === 'ArrowUp' && i >= n ? i - n : e.key === 'ArrowDown' && i < n * (n - 1) ? i + n : -1;
  if (e.key.startsWith('Arrow')) { e.preventDefault(); if (target >= 0) board.querySelector<HTMLButtonElement>(`[data-index="${target}"]`)?.focus(); }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); change(i, null); }
});
board.addEventListener('contextmenu', e => e.preventDefault()); board.addEventListener('selectstart', e => e.preventDefault());
// Второй щелчок может прийти уже после быстрой генерации первой партии.
function startFromClick(event: MouseEvent) { if (event.detail <= 1) void startGame(); }
$('#new').onclick = startFromClick; $('#hint').onclick = () => void requestHint();
// Удержание Enter не должно повторно запускать партию после окончания генерации.
root.addEventListener('keydown', event => {
  if (event.repeat && event.key === 'Enter' && (event.target as HTMLElement).matches('#new, #victory-new')) event.preventDefault();
});
$('#undo').onclick = () => { if (!state || busy || paused) return; syncTime(); state = undo(state); version++; hint = null; notice = ''; save(); render(); };
$('#reset').onclick = () => { if (!state || busy || paused) return; syncTime(); state = reset(state); version++; hint = null; notice = ''; save(); render(); };
$('#zoom').onclick = () => { zoom = !zoom; render(); };
let initialized = false;
const unsubscribe = container.onPauseChange(value => { paused = value; render(); if (initialized && !paused && !state && !busy) void startGame(); });
const interval = setInterval(() => { updateClock(); if (active) save(); }, 1000);
// BFCache сохраняет страницу живой: при возврате возобновляем те же службы.
window.addEventListener('pagehide', event => {
  suspended = true; syncActivity(); save();
  if (event.persisted) return;
  // При настоящем уходе запрещаем запоздалым ответам изменять уничтоженный экран.
  disposed = true; version++; clearInterval(interval); unsubscribe(); worker.dispose(); container.dispose();
});
window.addEventListener('pageshow', event => { if (event.persisted && !disposed) { suspended = false; render(); } });
await container.initialize();
if (!disposed) {
  initialized = true;
  if (state) { render(); container.ready(); } else if (!paused) { await startGame(); if (!disposed) container.ready(); } else { render(); container.ready(); }
}
