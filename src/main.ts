import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/pixelify-sans/latin-600.css';
import '@fontsource/pixelify-sans/latin-700.css';
import './style.css';
import { GAME_NAME } from './config';
import { Input } from './core/input';
import { SettingsStore } from './core/settings';
import { Game } from './game';
import { Platform } from './platform/crazygames';
import { LayeredStore, SafeLocalStore } from './platform/storage';
import { setLanguage, t } from './ui/i18n';
import { errorScreen, LoadingScreen, UIManager } from './ui/screens';

function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  document.title = GAME_NAME;
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ui = new UIManager(document.getElementById('ui')!);
  const loading = new LoadingScreen();
  ui.show(loading.el);

  const params = new URLSearchParams(location.search);
  const platform = new Platform();
  await platform.init({ loadSdk: !params.has('nosdk') });
  platform.loadingStart();
  loading.setProgress(0.2);

  const store = new LayeredStore(platform.dataStore, new SafeLocalStore('ccl.'));
  const settings = new SettingsStore(store);
  setLanguage(settings.value.language);

  if (!hasWebGL2()) {
    platform.loadingStop();
    ui.show(errorScreen(t('error.webgl')));
    return;
  }

  const input = new Input(canvas);
  const game = new Game({ canvas, ui, platform, settings, input });
  await game.init((p) => loading.setProgress(0.2 + p * 0.3));
  game.start();
  await game.openLatestWorld();

  // Let the area around the spawn generate behind the loading screen, so the
  // menu shows a living world and "Play" drops the player straight in.
  loading.setProgress(0.5, t('menu.generating'));
  await new Promise<void>((resolve) => {
    const started = performance.now();
    const poll = () => {
      const p = game.spawnProgress();
      loading.setProgress(0.5 + p * 0.5);
      if (p >= 0.999 || performance.now() - started > 12000) resolve();
      else setTimeout(poll, 50);
    };
    poll();
  });
  platform.loadingStop();
  game.showMainMenu();

  // Handy for debugging from the console and for end-to-end tests.
  (window as unknown as { game: Game }).game = game;
}

boot().catch((error: unknown) => {
  console.error(error);
  const root = document.getElementById('ui');
  if (root) root.textContent = String(error);
});
