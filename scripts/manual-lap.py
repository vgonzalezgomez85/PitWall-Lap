#!/usr/bin/env python3
"""Genera las 4 páginas HTML del manual de PitWall Lap (es, en, it, fr) a partir
de los Markdown de «PitWall Landing»: manual/content-lap{,.en,.it,.fr}.md.

Mismo diseño que el resto de manuales (manual/manual.css). Las capturas
(`![shot: archivo | barra | alt | pie]`) solo salen si el archivo existe en
manual/img/: no se publica ninguna imagen rota. Al añadir capturas, se vuelve a
ejecutar este script.

Uso: python3 scripts/manual-lap.py [carpeta-de-PitWall-Landing]
"""
import html
import os
import re
import sys

RAIZ = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/PitWall Landing')

LOGO = ('<svg class="mark" viewBox="0 0 100 100" fill="none" aria-hidden="true"><rect x="14.5" y="14.5" width="71" height="71" rx="22" '
        'stroke="#fff" stroke-width="6.5"/><path d="M31 38 L53 55 L31 72" stroke="#fff" stroke-width="7" stroke-linecap="round" '
        'stroke-linejoin="round"/><rect x="58" y="60" width="16.5" height="11.5" rx="3.6" fill="var(--red)"/></svg>PIT<b>WALL</b>')

ICO_TIP = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>'
ICO_WARN = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/></svg>'

# Archivo de cada idioma, y textos de la estructura (menú, índice, pie).
IDIOMAS = {
    'es': dict(md='content-lap.md', html='manual-lap.html', landing='pitwall-lap.html', uso='manual-uso.html', est='manual-estadisticas.html',
               nav_uso='Manual de uso', nav_est='Estadísticas', nav_lap='Manual de Lap', cta='Interpretar datos →',
               toc='Contenido', toc_label='Índice del manual', lang_label='Idioma', menu='Abrir menú', up='Volver arriba',
               xlink_uso='Manual de uso ↔', xlink_est='Manual de estadísticas ↔',
               foot='© 2026 · Cronometraje y gestión de slot racing'),
    'en': dict(md='content-lap.en.md', html='manual-lap.en.html', landing='pitwall-lap-en.html', uso='manual-uso.en.html', est='manual-estadisticas.en.html',
               nav_uso='User manual', nav_est='Statistics', nav_lap='Lap manual', cta='Interpret the data →',
               toc='Contents', toc_label='Manual contents', lang_label='Language', menu='Open menu', up='Back to top',
               xlink_uso='User manual ↔', xlink_est='Statistics manual ↔',
               foot='© 2026 · Slot racing timing and management'),
    'it': dict(md='content-lap.it.md', html='manual-lap.it.html', landing='pitwall-lap-it.html', uso='manual-uso.it.html', est='manual-estadisticas.it.html',
               nav_uso="Manuale d'uso", nav_est='Statistiche', nav_lap='Manuale di Lap', cta='Interpretare i dati →',
               toc='Contenuti', toc_label='Indice del manuale', lang_label='Lingua', menu='Apri menu', up='Torna su',
               xlink_uso="Manuale d'uso ↔", xlink_est='Manuale delle statistiche ↔',
               foot='© 2026 · Cronometraggio e gestione slot racing'),
    'fr': dict(md='content-lap.fr.md', html='manual-lap.fr.html', landing='pitwall-lap-fr.html', uso='manual-uso.fr.html', est='manual-estadisticas.fr.html',
               nav_uso="Manuel d'utilisation", nav_est='Statistiques', nav_lap='Manuel de Lap', cta='Interpréter les données →',
               toc='Sommaire', toc_label='Sommaire du manuel', lang_label='Langue', menu='Ouvrir le menu', up='Haut de page',
               xlink_uso="Manuel d'utilisation ↔", xlink_est='Manuel de statistiques ↔',
               foot='© 2026 · Chronométrage et gestion de slot racing'),
}
ORDEN_LANG = ['es', 'en', 'it', 'fr']


def inline(texto):
    """Markdown mínimo → HTML: **negrita**, *cursiva*, `código`, [texto](#ancla)."""
    t = html.escape(texto, quote=False)
    t = re.sub(r'`([^`]+)`', r'<span class="mono">\1</span>', t)
    t = re.sub(r'\*\*([^*]+)\*\*', r'<b>\1</b>', t)
    t = re.sub(r'(?<![\w*])\*([^*\n]+)\*(?!\w)', r'<i>\1</i>', t)
    t = re.sub(r'\[([^\]]+)\]\(#([\w-]+)\)', r'<a class="inl" href="#\2">\1</a>', t)
    return t


def leer_md(ruta):
    """(metadatos, secciones). Cada sección: dict(id, titulo, bloques)."""
    crudo = open(ruta, encoding='utf-8').read()
    m = re.match(r'---\n(.*?)\n---\n', crudo, re.S)
    meta = {}
    for linea in m.group(1).splitlines():
        k, _, v = linea.partition(':')
        meta[k.strip()] = v.strip()
    cuerpo = crudo[m.end():]

    secciones, sec, lineas = [], None, cuerpo.splitlines()
    i = 0
    while i < len(lineas):
        l = lineas[i]
        if l.startswith('## '):
            ident, _, titulo = l[3:].partition('|')
            sec = dict(id=ident.strip(), titulo=titulo.strip(), bloques=[])
            secciones.append(sec)
        elif sec is None or not l.strip():
            pass
        elif l.startswith('### '):
            sec['bloques'].append(('h3', l[4:].strip()))
        elif l.startswith('![shot:'):
            partes = [p.strip() for p in l[len('![shot:'):-1].split('|')]
            sec['bloques'].append(('fig', partes))
        elif l.startswith('> '):
            tipo, _, texto = l[2:].partition(':')
            sec['bloques'].append(('callout', tipo.strip(), texto.strip()))
        elif re.match(r'(-|\d+\.) ', l):
            ordenada = bool(re.match(r'\d+\. ', l))
            items = []
            while i < len(lineas) and re.match(r'(-|\d+\.) ', lineas[i]):
                items.append(re.sub(r'^(-|\d+\.) ', '', lineas[i]).strip())
                i += 1
            sec['bloques'].append(('ol' if ordenada else 'ul', items))
            continue
        else:
            parrafo = [l.strip()]
            while i + 1 < len(lineas) and lineas[i + 1].strip() and not re.match(r'(#|!\[|> |-|\d+\. )', lineas[i + 1]):
                i += 1
                parrafo.append(lineas[i].strip())
            sec['bloques'].append(('p', ' '.join(parrafo)))
        i += 1
    return meta, secciones


def render_bloque(b, img_dir):
    tipo = b[0]
    if tipo == 'h3':
        return f'      <h3>{inline(b[1])}</h3>\n'
    if tipo == 'p':
        return f'      <p>{inline(b[1])}</p>\n'
    if tipo in ('ul', 'ol'):
        lis = ''.join(f'        <li>{inline(x)}</li>\n' for x in b[1])
        return f'      <{tipo}>\n{lis}      </{tipo}>\n'
    if tipo == 'callout':
        clase, ico = ('warn', ICO_WARN) if b[1] == 'warn' else ('tip', ICO_TIP)
        return f'      <div class="callout {clase}">\n        {ico}\n        <div>{inline(b[2])}</div>\n      </div>\n'
    if tipo == 'fig':
        archivo, barra, alt, pie = (b[1] + ['', '', '', ''])[:4]
        if not os.path.exists(os.path.join(img_dir, archivo)):
            return ''                      # sin captura todavía: no se pinta nada
        return ('      <figure class="shot phone">\n'
                f'        <div class="shot-bar"><i></i><i></i><i></i><span>{html.escape(barra)}</span></div>\n'
                f'        <img src="manual/img/{archivo}" loading="lazy" alt="{html.escape(alt)}">\n'
                f'        <figcaption>{inline(pie)}</figcaption>\n'
                '      </figure>\n')
    raise ValueError(tipo)


def pagina(codigo, meta, secciones, img_dir):
    L = IDIOMAS[codigo]
    toc = ''.join(f'      <li><a href="#{s["id"]}">{html.escape(s["titulo"])}</a></li>\n' for s in secciones)
    cuerpo = ''
    for n, s in enumerate(secciones, 1):
        cuerpo += (f'    <section id="{s["id"]}">\n      <div class="num">// {n:02d}</div>\n      <h2>{html.escape(s["titulo"])}</h2>\n'
                   + ''.join(render_bloque(b, img_dir) for b in s['bloques']) + '    </section>\n\n')
    langs = ''.join(
        f'        <a href="{IDIOMAS[c]["html"]}"' + (' class="on" aria-current="page"' if c == codigo else '') + f'>{c.upper()}</a>\n'
        for c in ORDEN_LANG)
    return f'''<!DOCTYPE html>
<!--
  PitWall Web — Copyright (C) 2026 Víctor González Gómez <vgonzalezgomez@outlook.es>
  Software libre bajo la GNU Affero General Public License v3, o (a tu elección)
  cualquier versión posterior. Código fuente: https://github.com/vgonzalezgomez85/PitWallWeb
  Se ofrece SIN NINGUNA GARANTÍA. Véase <https://www.gnu.org/licenses/>.
-->
<html lang="{codigo}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PitWall · {html.escape(meta['title'])}</title>
<meta name="description" content="{html.escape(meta['descr'])}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@500;600;700;800&family=Saira:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="manual/manual.css">
<style>body{{--ac:var(--red)}} .doc figure.shot.phone{{max-width:340px;margin-left:0}} .doc figure.shot.phone img{{width:100%;height:auto;display:block}}</style>
  <script defer src="https://analytics.pitwall.es/script.js" data-website-id="7334c974-ac8b-4832-a607-78285f4dee4d"></script>
</head>
<body>

<header>
  <div class="wrap bar">
    <a class="logo" href="index.html">{LOGO}</a>
    <nav class="links" id="nav-links">
      <a href="{L['landing']}">Landing</a>
      <a href="{L['uso']}">{html.escape(L['nav_uso'])}</a>
      <a href="{L['html']}" class="here">{html.escape(L['nav_lap'])}</a>
      <a href="{L['est']}">{html.escape(L['nav_est'])}</a>
      <div class="lang" aria-label="{L['lang_label']}">
{langs}      </div>
      <a href="{L['est']}" class="nav-cta">{html.escape(L['cta'])}</a>
    </nav>
    <button class="menu-btn" type="button" aria-label="{L['menu']}" aria-expanded="false" aria-controls="nav-links"><span></span></button>
  </div>
</header>
<script>(function(){{var h=document.querySelector('header'),b=h.querySelector('.menu-btn');function s(o){{h.classList.toggle('open',o);b.setAttribute('aria-expanded',o)}}b.addEventListener('click',function(){{s(!h.classList.contains('open'))}});h.querySelectorAll('nav.links a').forEach(function(a){{a.addEventListener('click',function(){{s(false)}})}});document.addEventListener('keydown',function(e){{if(e.key==='Escape')s(false)}})}})();</script>

<a id="top"></a>
<section class="doc-hero">
  <div class="wrap">
    <div class="kicker">{html.escape(meta['kicker'])}</div>
    <h1>{meta['h1']}</h1>
    <p class="lede">{meta['lede']}</p>
    <div class="xlink">
      <a class="cur" href="{L['html']}">▮ {html.escape(L['nav_lap'])}</a>
      <a href="{L['uso']}">{html.escape(L['xlink_uso'])}</a>
      <a href="{L['est']}">{html.escape(L['xlink_est'])}</a>
    </div>
  </div>
</section>

<div class="wrap"><div class="rule"></div></div>

<div class="wrap doc-grid">
  <!-- TOC -->
  <nav class="toc" aria-label="{html.escape(L['toc_label'])}">
    <div class="toc-ttl">{html.escape(L['toc'])}</div>
    <ol>
{toc}    </ol>
  </nav>

  <!-- CONTENT -->
  <main class="doc">

{cuerpo}  </main>
</div>

<footer>
  <div class="wrap foot">
    <a class="logo" href="index.html">{LOGO}</a>
    <div class="apps-mini"><a href="{L['uso']}">{html.escape(L['nav_uso'])}</a><a href="{L['html']}">{html.escape(L['nav_lap'])}</a><a href="{L['est']}">{html.escape(L['nav_est'])}</a></div>
    <a class="mono" href="mailto:info.pitwall@gmail.com" data-umami-event="contact-email-footer">info.pitwall@gmail.com</a>
    <div class="mono">{html.escape(L['foot'])}</div>
  </div>
</footer>

<a href="#top" class="totop" aria-label="{L['up']}">↑</a>

<script>
(function(){{
  var links = Array.prototype.slice.call(document.querySelectorAll('.toc a'));
  var secs = links.map(function(a){{ return document.querySelector(a.getAttribute('href')); }});
  var totop = document.querySelector('.totop');
  function onScroll(){{
    var y = window.scrollY + 100, cur = 0;
    for (var i=0;i<secs.length;i++){{ if(secs[i] && secs[i].offsetTop <= y) cur = i; }}
    links.forEach(function(a,i){{ a.classList.toggle('active', i===cur); }});
    totop.classList.toggle('show', window.scrollY > 600);
  }}
  window.addEventListener('scroll', onScroll, {{passive:true}});
  onScroll();
}})();
</script>
</body>
</html>
'''


def main():
    img_dir = os.path.join(RAIZ, 'manual', 'img')
    hechos = []
    for codigo in ORDEN_LANG:
        ruta = os.path.join(RAIZ, 'manual', IDIOMAS[codigo]['md'])
        if not os.path.exists(ruta):
            print(f'  (falta {IDIOMAS[codigo]["md"]}: se omite {codigo})')
            continue
        meta, secciones = leer_md(ruta)
        salida = os.path.join(RAIZ, IDIOMAS[codigo]['html'])
        open(salida, 'w', encoding='utf-8').write(pagina(codigo, meta, secciones, img_dir))
        figs = sum(1 for s in secciones for b in s['bloques'] if b[0] == 'fig' and os.path.exists(os.path.join(img_dir, b[1][0])))
        total = sum(1 for s in secciones for b in s['bloques'] if b[0] == 'fig')
        hechos.append(f'{IDIOMAS[codigo]["html"]}: {len(secciones)} secciones, capturas {figs}/{total}')
    print('\n'.join(hechos))


if __name__ == '__main__':
    main()
