#!/usr/bin/env python3
"""Refresh bundled palette data. Reads TOML/JSON only; never installs theme code."""
import concurrent.futures, json, pathlib, re, tomllib, urllib.request
ROOT = pathlib.Path(__file__).resolve().parent.parent

def fetch(url):
    with urllib.request.urlopen(url, timeout=12) as r:
        return r.read().decode()

def palette(repo):
    if not re.fullmatch(r'https://github.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo):
        raise ValueError('Expected a public GitHub theme repository')
    raw = repo.replace('https://github.com/', 'https://raw.githubusercontent.com/').removesuffix('.git') + '/HEAD/'
    for file in ['colors.toml', 'alacritty.toml']:
        try:
            data = tomllib.loads(fetch(raw + file))
            if file == 'alacritty.toml':
                c = data['colors']; n = c['normal']; p = c['primary']
                data = dict(background=p['background'], foreground=p['foreground'], accent=n['blue'], red=n['red'], green=n['green'], yellow=n['yellow'], blue=n['blue'], magenta=n['magenta'], cyan=n['cyan'])
            colors = {k: v.lower() for k, v in data.items() if isinstance(v, str) and re.fullmatch(r'#[0-9a-fA-F]{6}', v)}
            if all(k in colors for k in ['background','foreground','accent']):
                mode = data.get('mode')
                if mode not in ['light','dark']:
                    bg=colors['background']; mode='light' if sum(int(bg[i:i+2],16) for i in (1,3,5))>420 else 'dark'
                return colors, mode
        except Exception:
            pass
    return None

entries = json.loads(fetch('https://api.github.com/repos/omacom/omarchy-theme-registry/contents/themes'))
def community(entry):
    try:
        meta=json.loads(fetch(entry['download_url']))
        result=palette(meta['repo'])
        if result:
            colors,mode=result
            return dict(id='community-'+meta['slug'],name=meta['name'],group='Omarchy community',source=meta['repo'],mode=mode,colors=colors)
    except Exception:
        pass
    return None
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
    themes=[x for x in pool.map(community,entries) if x]
# Stock palettes are also available with Omarchy installed on the development host.
for path in sorted(pathlib.Path('/usr/share/omarchy/themes').glob('*/colors.toml')):
    data=tomllib.loads(path.read_text()); slug=path.parent.name
    colors={k:v.lower() for k,v in data.items() if isinstance(v,str) and re.fullmatch(r'#[0-9a-fA-F]{6}',v)}
    if all(k in colors for k in ['background','foreground','accent']):
        themes.append(dict(id=slug,name=slug.replace('-',' ').title().replace('Catppuccin','Catppuccin'),group='Omarchy',source='https://github.com/omacom/omarchy/tree/quattro/themes/'+slug,mode=data.get('mode','dark'),colors=colors))
result=palette('https://github.com/leonardobetti/omarchy-tycho')
if not result: raise RuntimeError('Tycho palette unavailable')
colors,mode=result
themes.append(dict(id='tycho',name='Tycho',group='Featured',source='https://github.com/leonardobetti/omarchy-tycho',mode=mode,colors=colors))
for theme in themes:
    if theme['id'] in ['catppuccin','catppuccin-latte','community-dracula']:
        theme['group']='Featured'
        if theme['id']=='catppuccin': theme['name']='Catppuccin Mocha'
for theme in themes:
    theme['colors']={key:theme['colors'].get(key, theme['colors']['accent']) for key in ['background','foreground','accent','red','green','yellow','blue','magenta','cyan']}
themes.sort(key=lambda x:(x['group']!='Featured', x['group'],x['name'].lower()))
(ROOT/'src/data/themes.json').write_text(json.dumps(themes,indent=2)+'\n')
print(f'Bundled {len(themes)} palettes ({len(entries)} community entries checked).')
