#!/usr/bin/env python3
"""Build Blinkly's Chromium and Firefox variants from the same offline sources."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import zipfile

root = Path(__file__).resolve().parents[1]
pack = json.loads((root / 'audio/manifest.json').read_text())
assert pack['complete'] and len(pack['clips']) == pack['expectedCount']
manifest = json.loads((root / 'manifest.json').read_text())
files = ['manifest.json', 'background.js', 'popup.html', 'popup.js', 'options.html', 'sleep-schedule.js', 'reminder-preferences.js', 'voice-data/pet-clips.js', 'voice-lines.js', 'blinkly-scenes.js', 'widget-placement.js', 'voice-cadence.js', 'blinkly.user.js', 'README.md', 'audio/manifest.json']
files += [f'icons/icon{size}.png' for size in [16, 32, 48, 128]]
files += ['assets/blinkly-logo.png', 'assets/blinkly-logo-prompt.txt', 'design/previews/popup.png', 'design/previews/mist-end.png']
files += [clip['file'] for clip in pack['clips'].values()]
for clip in pack['clips'].values():
    data = (root / clip['file']).read_bytes()
    assert len(data) == clip['bytes']
    assert hashlib.sha256(data).hexdigest() == clip['sha256']
for name in files:
    source = root / name
    assert source.is_file(), name
    if source.suffix in ('.js', '.json', '.html', '.md', '.txt'):
        assert not re.search(rb'sk_[a-f0-9]{30,}', source.read_bytes()), name

def build(name, firefox=False):
    release = root / name
    release.mkdir(exist_ok=True)
    expected = set(files)
    previous_manifest = release / 'manifest.json'
    if previous_manifest.exists():
        previous = json.loads(previous_manifest.read_text())
        previous_scripts = {script for content in previous.get('content_scripts', []) for script in content.get('js', [])}
        # Remove retired generated entry points after a source-file rename.
        for retired_script in previous_scripts - expected:
            obsolete = release / retired_script
            if Path(retired_script).name == retired_script and retired_script.endswith('.js') and obsolete.is_file():
                obsolete.unlink()
    # Remove only obsolete generated MP3s from this previously built release.
    for obsolete in (release / 'audio').glob('vo_*.mp3'):
        if str(obsolete.relative_to(release)) not in expected:
            obsolete.unlink()
    for file in files:
        target = release / file
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / file, target)
    release_manifest = dict(manifest)
    if firefox:
        release_manifest['background'] = {'scripts': ['sleep-schedule.js', 'reminder-preferences.js', 'voice-cadence.js', 'background.js']}
        release_manifest['host_permissions'] = ['http://*/*', 'https://*/*']
        release_manifest['browser_specific_settings'] = {'gecko': {
            'id': 'blinkly@local.extension', 'strict_min_version': '140.0',
            'data_collection_permissions': {'required': ['none']}
        }}
    (release / 'manifest.json').write_text(json.dumps(release_manifest, indent=2) + '\n')
    actual = {str(p.relative_to(release)) for p in release.rglob('*') if p.is_file() and p.name != '.DS_Store'}
    assert actual == expected, (name, actual - expected)
    archive = root / f'{release.name}.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as out:
        for file in files:
            # Firefox's Load Temporary Add-on and signing expect a root manifest.
            out.write(release / file, file if firefox else f'{release.name}/{file}')
    with zipfile.ZipFile(archive) as check:
        assert check.testzip() is None
    return {'folder': str(release), 'zip': str(archive), 'clips': len(pack['clips']),
            'files': len(files), 'zipBytes': archive.stat().st_size,
            'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'firefox': firefox}

results = [build('blinkly-chromium'), build('blinkly-firefox', firefox=True)]
# A named Helium copy is convenient for local unpacked installations.
results.append(build('blinkly-helium'))
print(json.dumps(results, indent=2))
