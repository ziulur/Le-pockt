#!/usr/bin/env python3
"""Monta o LE Pocket a partir de src/ (só biblioteca padrão do Python).

Uso:
  python3 tools/build.py            -> gera dist/
  python3 tools/build.py --publish  -> gera dist/ e copia a versão web para a raiz (GitHub Pages) e web/
  python3 tools/build.py --check    -> gera dist/ e falha se a raiz/web/ não estiverem iguais ao build

Saída (dist/):
  web/LE-Pocket.html        emulador em um arquivo só (Claude, Windows, apps Android/iOS)
  pwa/                      versão instalável (index.html, sw.js, manifest, ícones)
  windows/                  pacote para Windows (html, ícone, instalador .bat, leia-me)
  MANIFEST.txt              lista de arquivos gerados com tamanho e sha256
"""
import hashlib, json, os, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC, DIST = os.path.join(ROOT, 'src'), os.path.join(ROOT, 'dist')
CORES = ['gbcore.js', 'gba.js', 'armcpu.js', 'nds.js', 'nds3d.js', 'ndssnd.js', 'n3ds.js', 'n3dsgpu.js']  # a ordem importa
ICONS = ['icon-180.png', 'icon-192.png', 'icon-512.png']
REQUIRED = ['ui.html'] + ['cores/' + c for c in CORES] + ['assets/' + i for i in ICONS] + [
    'assets/LE-Pocket.ico', 'platform/windows/Instalar no Windows.bat', 'platform/windows/LEIA-ME.txt']
PUBLISHED = {'index.html': 'pwa/index.html', 'sw.js': 'pwa/sw.js', 'manifest.webmanifest': 'pwa/manifest.webmanifest',
             'icon-180.png': 'pwa/icon-180.png', 'icon-192.png': 'pwa/icon-192.png', 'icon-512.png': 'pwa/icon-512.png',
             'web/index.html': 'web/LE-Pocket.html'}


def fail(msg):
    print('ERRO: ' + msg, file=sys.stderr)
    sys.exit(1)


def read(rel):
    with open(os.path.join(SRC, rel), encoding='utf-8') as f:
        return f.read()


def write(rel, data, binary=False, newline=None):
    p = os.path.join(DIST, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    if binary:
        with open(p, 'wb') as f: f.write(data)
    else:
        with open(p, 'w', encoding='utf-8', newline=newline) as f: f.write(data)


def sha(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


PWA_HEAD = '''<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="icon" type="image/png" href="icon-192.png">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="LE Pocket">
<meta name="mobile-web-app-capable" content="yes">'''

PWA_JS = '''(() => {
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) {}
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone) return;
  const box = $('installBox'); let deferred = null;
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIos) { box.style.display = ''; $('installHint').textContent = 'No Safari: toque em Compartilhar e depois em “Adicionar à Tela de Início”'; }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; box.style.display = ''; });
  window.addEventListener('appinstalled', () => { box.style.display = 'none'; toast('Instalado ✓'); });
  $('mInstall').onclick = async () => {
    if (deferred) { const d = deferred; deferred = null; try { d.prompt(); await d.userChoice; } catch (e) {} }
    else toast(isIos ? 'Compartilhar → Adicionar à Tela de Início' : 'Use o menu do navegador → Instalar aplicativo');
  };
})();'''

SW_TEMPLATE = '''const C = 'lepocket-%s';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-180.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(C).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(C).then((c) => c.put(e.request, cp)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
});
'''

MANIFEST = {"name": "LE Pocket 3DS", "short_name": "LE Pocket 3DS", "description": "LE Pocket em produção: Game Boy até Nintendo 3DS",
            "lang": "pt-BR", "start_url": "./", "scope": "./", "display": "standalone", "orientation": "any",
            "background_color": "#16141c", "theme_color": "#16141c",
            "icons": [{"src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
                      {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
                      {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}]}


def build():
    missing = [r for r in REQUIRED if not os.path.isfile(os.path.join(SRC, r))]
    if missing: fail('arquivos obrigatórios ausentes em src/: ' + ', '.join(missing))
    ui = read('ui.html')
    for mark in ('/*CORE*/', '<!--PWAHEAD-->', '/*PWA*/'):
        if ui.count(mark) != 1: fail(f'src/ui.html deve ter exatamente um marcador {mark} (tem {ui.count(mark)})')
    parts = []
    for c in CORES:
        code = read('cores/' + c)
        if '</script' in code.lower(): fail(f'src/cores/{c} contém "</script", que quebraria a página')
        if not code.strip(): fail(f'src/cores/{c} está vazio')
        parts.append(code)
    base = ui.replace('/*CORE*/', '\n'.join(parts))
    if os.path.isdir(DIST): shutil.rmtree(DIST)
    plain = base.replace('<!--PWAHEAD-->\n', '').replace('/*PWA*/', '')
    write('web/LE-Pocket.html', plain)
    pwa = base.replace('<!--PWAHEAD-->', PWA_HEAD).replace('/*PWA*/', PWA_JS)
    write('pwa/index.html', pwa)
    write('pwa/manifest.webmanifest', json.dumps(MANIFEST, ensure_ascii=False, indent=1))
    for i in ICONS:
        with open(os.path.join(SRC, 'assets', i), 'rb') as f: write('pwa/' + i, f.read(), binary=True)
    # o nome do cache muda sempre que a página muda: o celular nunca mistura versões
    write('pwa/sw.js', SW_TEMPLATE % hashlib.sha256(pwa.encode('utf-8')).hexdigest()[:12])
    write('windows/LE-Pocket.html', plain)
    with open(os.path.join(SRC, 'assets', 'LE-Pocket.ico'), 'rb') as f: write('windows/LE-Pocket.ico', f.read(), binary=True)
    for n in ('Instalar no Windows.bat', 'LEIA-ME.txt'):
        with open(os.path.join(SRC, 'platform', 'windows', n), 'rb') as f: write('windows/' + n, f.read(), binary=True)
    lines = []
    for d, _, fs in sorted(os.walk(DIST)):
        for n in sorted(fs):
            p = os.path.join(d, n); rel = os.path.relpath(p, DIST)
            if rel == 'MANIFEST.txt': continue
            lines.append(f'{os.path.getsize(p):>9}  {sha(p)[:16]}  {rel}')
    write('MANIFEST.txt', '\n'.join(lines) + '\n')
    print('dist/ gerado:\n' + '\n'.join(lines))


def published_diffs():
    out = []
    for dst, src in PUBLISHED.items():
        a, b = os.path.join(ROOT, dst), os.path.join(DIST, src)
        if not os.path.isfile(a) or sha(a) != sha(b): out.append(dst)
    return out


if __name__ == '__main__':
    build()
    if '--publish' in sys.argv:
        for dst, src in PUBLISHED.items():
            os.makedirs(os.path.dirname(os.path.join(ROOT, dst)) or ROOT, exist_ok=True)
            shutil.copyfile(os.path.join(DIST, src), os.path.join(ROOT, dst))
        print('publicado na raiz e em web/:', ', '.join(PUBLISHED))
    elif '--check' in sys.argv:
        d = published_diffs()
        if d: fail('os arquivos publicados estão diferentes do build (rode tools/build.py --publish): ' + ', '.join(d))
        print('arquivos publicados conferem com o build')
