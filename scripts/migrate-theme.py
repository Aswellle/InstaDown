import re
import pathlib

REPL = [
    (r'\bbg-zinc-950/90\b', 'bg-app/95'),
    (r'\bbg-zinc-950/80\b', 'bg-app/80'),
    (r'\bbg-zinc-950\b', 'bg-app'),
    (r'\bbg-zinc-900/50\b', 'bg-surface/60'),
    (r'\bbg-zinc-900/40\b', 'bg-surface/50'),
    (r'\bbg-zinc-900/60\b', 'bg-surface-hover'),
    (r'\bbg-zinc-900/95\b', 'bg-surface/95'),
    (r'\bbg-zinc-900\b', 'bg-surface'),
    (r'\bbg-zinc-800/70\b', 'bg-surface-hover'),
    (r'\bbg-zinc-800\b', 'bg-surface-hover'),
    (r'\bbg-zinc-700\b', 'bg-surface-active'),
    (r'\bbg-zinc-600\b', 'bg-surface-active'),
    (r'\btext-zinc-100\b', 'text-app'),
    (r'\btext-zinc-200\b', 'text-app'),
    (r'\btext-zinc-300\b', 'text-muted'),
    (r'\btext-zinc-400\b', 'text-muted'),
    (r'\btext-zinc-500\b', 'text-subtle'),
    (r'\btext-zinc-600\b', 'text-subtle'),
    (r'\bborder-zinc-800/80\b', 'border-app'),
    (r'\bborder-zinc-800\b', 'border-app'),
    (r'\bborder-zinc-700/60\b', 'border-app-strong'),
    (r'\bborder-zinc-700\b', 'border-app-strong'),
    (r'\bborder-zinc-600\b', 'border-app-strong'),
    (r'\bborder-zinc-500\b', 'border-app-strong'),
    (r'\bborder-zinc-300\b', 'border-app-strong'),
    (r'\bhover:bg-zinc-800/60\b', 'hover:bg-surface-hover'),
    (r'\bhover:bg-zinc-800\b', 'hover:bg-surface-hover'),
    (r'\bhover:bg-zinc-700\b', 'hover:bg-surface-active'),
    (r'\bhover:bg-zinc-900/60\b', 'hover:bg-surface-hover'),
    (r'\bhover:bg-zinc-900\b', 'hover:bg-surface-hover'),
    (r'\bhover:text-zinc-100\b', 'hover:text-app'),
    (r'\bhover:text-zinc-200\b', 'hover:text-app'),
    (r'\bhover:text-zinc-300\b', 'hover:text-muted'),
    (r'\bhover:border-zinc-600\b', 'hover:border-app-strong'),
    (r'\bhover:border-zinc-300\b', 'hover:border-app-strong'),
    (r'\bfocus-visible:border-zinc-600\b', 'focus-visible:border-app-strong'),
]

changed = []
for f in list(pathlib.Path('.').rglob('*.tsx')) + list(pathlib.Path('.').rglob('*.ts')):
    norm = str(f).replace(chr(92), '/')
    if 'ui/primitives.tsx' in norm:
        continue
    src = f.read_text(encoding='utf-8')
    orig = src
    for pat, rep in REPL:
        src = re.sub(pat, rep, src)
    if src != orig:
        f.write_text(src, encoding='utf-8')
        changed.append(norm)
print('\n'.join(changed) if changed else '(no changes)')
