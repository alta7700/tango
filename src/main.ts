import './style.css';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Не найден контейнер приложения');

app.innerHTML = `
  <section class="welcome">
    <span class="symbols" aria-hidden="true">☀ ☾</span>
    <h1>Tango</h1>
    <p>Подготовка игры</p>
  </section>
`;
