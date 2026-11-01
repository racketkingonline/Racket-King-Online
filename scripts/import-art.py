# Importa le illustrazioni scaricate da Higgsfield: riconosce il file dal codice della generazione nel nome
# oppure, se manca, dall'inizio del prompt (nomi tipo "medium_shot_inside_a_small_family...png"),
# lo rinomina con l'id del gioco, lo converte in JPEG (lato lungo max 1920 per i formati larghi, 900 per gli altri).
# Uso: python3 scripts/import-art.py <cartella con i png> [elenco.csv]
import csv, glob, os, re, sys
from PIL import Image
src = sys.argv[1]; elenco = sys.argv[2] if len(sys.argv) > 2 else '/home/claude/illustrazioni/elenco.csv'
rows = list(csv.DictReader(open(elenco), delimiter=';'))
out = os.path.join(os.path.dirname(__file__), '..', 'public', 'art'); os.makedirs(out, exist_ok=True)
files = [f for f in glob.glob(os.path.join(src, '**', '*.*'), recursive=True) if re.search(r'\.(png|jpe?g|webp)$', f, re.I)]
slug = lambda x: re.sub(r'[^a-z0-9]', '', x.lower())
used = set(); found = 0
for r in rows:
    m = [f for f in files if r['job_id'] in os.path.basename(f)]
    if not m and r.get('prompt'):
        p = slug(r['prompt'])
        m = [f for f in files if f not in used and (n := slug(re.sub(r'\.\w+$', '', os.path.basename(f)))[:30]) and p.startswith(n[:max(12, len(n) - 4)])]
    if not m: print('manca', r['id']); continue
    used.add(m[0])
    im = Image.open(m[0]).convert('RGB')
    big = 1920 if r['formato'] in ('16:9', '21:9') else 900
    im.thumbnail((big, big))
    im.save(os.path.join(out, r['id'] + '.jpg'), quality=82, optimize=True, progressive=True)
    found += 1
print(f'{found} su {len(rows)} illustrazioni importate in public/art')
