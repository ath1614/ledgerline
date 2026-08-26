import '@fontsource-variable/archivo';
import '@fontsource/gloock';
import '@fontsource/jetbrains-mono/400.css';
import gsap from 'gsap';
import Lenis from 'lenis';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!reduce) {
  const lenis = new Lenis({ duration: 1.1, smoothWheel: true });
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
