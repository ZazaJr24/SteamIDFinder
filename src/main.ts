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
  loading.setProgress(1);
  platform.loadingStop();
  game.start();
  game.showMainMenu();

  // Handy for debugging from the console and for end-to-end tests.
  (window as unknown as { game: Game }).game = game;
}

boot().catch((error: unknown) => {
  console.error(error);
  const root = document.getElementById('ui');
  if (root) root.textContent = String(error);
});
