// Antibot lato browser: risolve la prova di calcolo del server (SHA-256 con N bit iniziali a zero)
// mentre la persona compila il modulo. Turnstile di Cloudflare solo se il server lo richiede.
import { useEffect, useRef, useState } from 'react';

export type Pow = { salt: string; bits: number; issued: number; sig: string; nonce?: string };
type Challenge = Pow & { turnstile: string | null };

// SHA-256 di un messaggio corto (≤ 55 byte, un solo blocco): restituisce la prima parola a 32 bit dell'hash.
const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
const W = new Uint32Array(64);
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
export function sha256Head(msg: string): number {
  W.fill(0);
  for (let i = 0; i < msg.length; i++) W[i >> 2] |= (msg.charCodeAt(i) & 0xff) << (24 - (i % 4) * 8);
  W[msg.length >> 2] |= 0x80 << (24 - (msg.length % 4) * 8);
  W[15] = msg.length * 8;
  for (let i = 16; i < 64; i++) {
    const a = W[i - 15], b = W[i - 2];
    W[i] = (W[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + W[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) | 0;
  }
  let a = 0x6a09e667, b = 0xbb67ae85, c = 0x3c6ef372, d = 0xa54ff53a, e = 0x510e527f, f = 0x9b05688c, g = 0x1f83d9ab, h = 0x5be0cd19;
  for (let i = 0; i < 64; i++) {
    const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
    const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  return (0x6a09e667 + a) >>> 0;
}

/** Cerca il numero giusto a pezzi, senza bloccare la pagina. */
async function solve(ch: Pow): Promise<Pow> {
  const limit = 2 ** (32 - ch.bits);
  for (let n = 0; ; n++) {
    if (sha256Head(`${ch.salt}:${n}`) < limit) return { salt: ch.salt, bits: ch.bits, issued: ch.issued, sig: ch.sig, nonce: String(n) };
    if (n % 20000 === 19999) await new Promise(r => setTimeout(r, 0));
  }
}

declare global { interface Window { turnstile?: { render: (el: HTMLElement, o: { sitekey: string; callback: (t: string) => void; theme?: string }) => string } } }

/** Prepara la verifica appena il modulo compare; get() aspetta che sia pronta e restituisce i campi da mandare. */
export function useAntibot() {
  const [ch, setCh] = useState<Challenge | null>(null);
  const solved = useRef<Promise<Pow> | null>(null);
  const ts = useRef<string>('');
  const loadedAt = useRef(0);
  const box = useRef<HTMLDivElement | null>(null);
  const load = () => { loadedAt.current = Date.now(); solved.current = null; void fetch('/api/alpha/challenge').then(r => r.json()).then((c: Challenge) => { setCh(c); solved.current = solve(c); }); };
  useEffect(load, []);
  useEffect(() => {
    if (!ch?.turnstile || !box.current) return;
    const render = () => { if (box.current && window.turnstile && !box.current.childElementCount) window.turnstile.render(box.current, { sitekey: ch.turnstile!, theme: 'dark', callback: t => { ts.current = t; } }); };
    if (window.turnstile) render();
    else { const s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'; s.async = true; s.onload = render; document.head.appendChild(s); }
  }, [ch]);
  return {
    box, needsTurnstile: !!ch?.turnstile,
    /** I campi antibot da aggiungere alla richiesta (campo trappola compreso). */
    async get(website: string) {
      while (!solved.current) await new Promise(r => setTimeout(r, 100));
      const pow = await solved.current;
      const wait = loadedAt.current + 3300 - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait));
      return { pow, turnstile: ts.current, website };
    },
    /** Dopo ogni invio la sfida è consumata: se ne prende un'altra. */
    reset: load,
  };
}
