"""Troca o ícone do app pela logo: gera todos os tamanhos do Android e da versão web.

Uso (na pasta do projeto):
    python ferramentas/icone.py caminho/da/logo.png
    python ferramentas/icone.py logo.png --fundo "#FC5200" --escala 0.6

--fundo   cor atrás da logo (padrão: a cor dos cantos da logo, ou branco se for transparente)
--escala  quanto da área do ícone adaptativo do Android a logo ocupa (padrão 0,667: a logo
          inteira fica na área visível; use menos se a logo encostar nas bordas)

Gera: mipmap-*/ic_launcher*.png, a cor de fundo do ícone adaptativo, os splash.png,
icons/icone-*.png, icons/apple-touch-icon.png e guarda a logo em icons/logo-original.
Precisa do Pillow (pip install pillow). Não mexe no ícone da notificação (ic_pedal.xml).
"""
import argparse
import glob
import os
from collections import Counter

from PIL import Image, ImageDraw

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(RAIZ, 'android', 'app', 'src', 'main', 'res')
DENSIDADES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}


def cor_hex(c):
    return '#{:02X}{:02X}{:02X}'.format(*c[:3])


def ler_cor(txt):
    txt = txt.strip().lstrip('#')
    return tuple(int(txt[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


def cor_dos_cantos(img):
    """Cor mais comum na borda da logo; None se a borda for transparente."""
    w, h = img.size
    borda = [img.getpixel((x, y)) for x in range(0, w, max(1, w // 64)) for y in (0, h - 1)]
    borda += [img.getpixel((x, y)) for y in range(0, h, max(1, h // 64)) for x in (0, w - 1)]
    opacos = [p[:3] for p in borda if p[3] > 200]
    if len(opacos) < len(borda) * 0.6:
        return None
    # agrupa cores parecidas (ruído de JPG)
    comum = Counter((r // 8, g // 8, b // 8) for r, g, b in opacos).most_common(1)[0][0]
    perto = [p for p in opacos if (p[0] // 8, p[1] // 8, p[2] // 8) == comum]
    return tuple(sum(c[i] for c in perto) // len(perto) for i in range(3)) + (255,)


def quadrada(img, fundo):
    """Logo num quadrado, completando com a cor de fundo."""
    w, h = img.size
    lado = max(w, h)
    q = Image.new('RGBA', (lado, lado), fundo)
    q.alpha_composite(img, ((lado - w) // 2, (lado - h) // 2))
    return q


def no_centro(logo, tam, escala, fundo):
    """Logo quadrada ocupando `escala` do lado de uma imagem `tam` x `tam`."""
    tela = Image.new('RGBA', (tam, tam), fundo)
    lado = max(1, round(tam * escala))
    tela.alpha_composite(logo.resize((lado, lado), Image.LANCZOS), ((tam - lado) // 2, (tam - lado) // 2))
    return tela


def redonda(img):
    tam = img.size[0]
    grande = tam * 4
    mascara = Image.new('L', (grande, grande), 0)
    ImageDraw.Draw(mascara).ellipse((0, 0, grande - 1, grande - 1), fill=255)
    out = Image.new('RGBA', (tam, tam), (0, 0, 0, 0))
    out.paste(img, (0, 0), mascara.resize((tam, tam), Image.LANCZOS))
    return out


def salvar(img, caminho, rgb=False):
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    (img.convert('RGB') if rgb else img).save(caminho, optimize=True)
    print('  ', os.path.relpath(caminho, RAIZ), img.size[0], 'x', img.size[1])


def main():
    ap = argparse.ArgumentParser(description='Gera os ícones do app a partir da logo.')
    ap.add_argument('logo')
    ap.add_argument('--fundo')
    ap.add_argument('--escala', type=float, default=72 / 108)
    a = ap.parse_args()

    original = Image.open(a.logo).convert('RGBA')
    fundo = ler_cor(a.fundo) if a.fundo else (cor_dos_cantos(original) or (255, 255, 255, 255))
    transparente = cor_dos_cantos(original) is None
    logo = quadrada(original, fundo)
    print('Logo', original.size, '· fundo', cor_hex(fundo), '· transparente' if transparente else '')

    # Logo transparente ganha respiro; logo com fundo próprio vai até a borda
    cheio = 0.78 if transparente else 1.0

    print('Android:')
    for nome, k in DENSIDADES.items():
        pasta = os.path.join(RES, f'mipmap-{nome}')
        legado = no_centro(logo, round(48 * k), cheio, fundo)
        salvar(legado, os.path.join(pasta, 'ic_launcher.png'), rgb=True)
        salvar(redonda(legado), os.path.join(pasta, 'ic_launcher_round.png'))
        salvar(no_centro(logo, round(108 * k), a.escala, (0, 0, 0, 0)), os.path.join(pasta, 'ic_launcher_foreground.png'))
    with open(os.path.join(RES, 'values', 'ic_launcher_background.xml'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                f'    <color name="ic_launcher_background">{cor_hex(fundo)}</color>\n</resources>\n')
    print('   values/ic_launcher_background.xml', cor_hex(fundo))

    print('Abertura (splash):')
    for caminho in sorted(glob.glob(os.path.join(RES, 'drawable*', 'splash.png'))):
        w, h = Image.open(caminho).size
        tela = Image.new('RGBA', (w, h), fundo)
        lado = round(min(w, h) * 0.42)
        tela.alpha_composite(no_centro(logo, lado, cheio, fundo), ((w - lado) // 2, (h - lado) // 2))
        salvar(tela, caminho, rgb=True)

    print('Web:')
    icones = os.path.join(RAIZ, 'icons')
    salvar(no_centro(logo, 192, cheio, fundo), os.path.join(icones, 'icone-192.png'), rgb=True)
    salvar(no_centro(logo, 512, cheio, fundo), os.path.join(icones, 'icone-512.png'), rgb=True)
    salvar(no_centro(logo, 512, 0.8 if transparente else 1.0, fundo), os.path.join(icones, 'icone-maskable-512.png'), rgb=True)
    salvar(no_centro(logo, 180, cheio, fundo), os.path.join(icones, 'apple-touch-icon.png'), rgb=True)

    with open(a.logo, 'rb') as f:
        bruto = f.read()
    for velho in glob.glob(os.path.join(icones, 'logo-original.*')):
        os.remove(velho)
    destino = os.path.join(icones, 'logo-original' + os.path.splitext(a.logo)[1].lower())
    with open(destino, 'wb') as f:
        f.write(bruto)
    print('Logo guardada em', os.path.relpath(destino, RAIZ))
    print('Pronto. Suba a VERSAO em sw.js e js/app.js antes do push.')


if __name__ == '__main__':
    main()
