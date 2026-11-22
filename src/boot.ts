import './ui/styles.css';
import RAPIER from '@dimforge/rapier3d-compat';
import { App } from './App';

const boot = document.getElementById('boot')!;
const bar = boot.querySelector('.bar i') as HTMLElement;
const msg = boot.querySelector('p') as HTMLElement;
const setProgress = (p: number, text?: string) => {
  bar.style.width = `${Math.round(p * 100)}%`;
  if (text) msg.textContent = text;
};

function fail(text: string) {
  boot.innerHTML = `<h1>HEISTMAS</h1><p class="err">${text}</p>`;
}

function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

async function main() {
  if (!hasWebGL2()) {
    fail('Your browser or device does not support WebGL 2, which Heistmas needs for its 3D graphics. Try a recent Chrome, Edge, Firefox or Safari on a desktop computer.');
    return;
  }
  setProgress(0.15, 'Waking up the physics elves…');
  await RAPIER.init();
  setProgress(0.45, 'Wrapping presents…');
  // make sure the display font is ready before canvases draw text with it
  try {
    await Promise.race([document.fonts.load('40px "Titan One"'), new Promise((r) => setTimeout(r, 1500))]);
  } catch {
    /* ignore */
  }
  setProgress(0.65, 'Polishing the gold bars…');
  const app = new App(document.getElementById('app')!);
  setProgress(0.85, 'Hanging the string lights…');
  await app.start();
  setProgress(1, 'Ready!');
  boot.classList.add('hide');
  setTimeout(() => boot.remove(), 600);
}

main().catch((e) => {
  console.error(e);
  fail('Something went wrong while loading Heistmas. Please refresh the page.<br><small style="opacity:.6">' + String(e?.message ?? e) + '</small>');
});
