#!/usr/bin/env python3
"""Generate the offline pack once. Keys come only from environment variables.
Existing valid files are reused. API access is never used by the extension.
"""
import argparse
import concurrent.futures
import hashlib
import json
import os
import signal
from pathlib import Path
import threading
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'audio/catalog.json'
MANIFEST = ROOT / 'audio/manifest.json'
STOP = threading.Event()
signal.signal(signal.SIGTERM, lambda *_: STOP.set())
signal.signal(signal.SIGINT, lambda *_: STOP.set())

def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.json.part')
    temp.write_text(json.dumps(data, indent=2) + '\n')
    temp.replace(path)

def valid_mp3(data):
    return len(data) > 512 and (data[:3] == b'ID3' or (data[0] == 255 and data[1] & 224 == 224))

def assemble(catalog, manifest=MANIFEST):
    clips = {}
    for clip in catalog['clips']:
        path = ROOT / clip['file']
        if not path.exists():
            continue
        data = path.read_bytes()
        if not valid_mp3(data):
            raise ValueError('Invalid audio: ' + clip['file'])
        clips[clip['key']] = dict(clip, bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
    pack = {k: v for k, v in catalog.items() if k != 'clips'}
    pack.update(schema=1, complete=len(clips) == len(catalog['clips']), expectedCount=len(catalog['clips']), count=len(clips), bytes=sum(x['bytes'] for x in clips.values()), clips=clips)
    atomic_json(manifest, pack)
    return pack

def read_api_keys(environ=None):
    environ = os.environ if environ is None else environ
    ordered = environ.get('ELEVENLABS_API_KEYS', '').strip()
    if ordered:
        try:
            keys = json.loads(ordered)
        except json.JSONDecodeError:
            raise ValueError('ELEVENLABS_API_KEYS must be a JSON array of nonempty strings.') from None
        if not isinstance(keys, list) or not keys or any(not isinstance(key, str) or not key.strip() for key in keys):
            raise ValueError('ELEVENLABS_API_KEYS must be a JSON array of nonempty strings.')
        return [key.strip() for key in keys]
    key = environ.get('ELEVENLABS_API_KEY', '').strip()
    return [key] if key else []

class KeyPool:
    """A shared ordered cursor; only an explicit quota response may advance it."""
    def __init__(self, keys):
        self.keys = tuple(keys)
        self.index = 0
        self.lock = threading.Lock()

    def current(self):
        with self.lock:
            if self.index >= len(self.keys):
                raise RuntimeError('All configured key slots exhausted their quota. Add credits or resume with a funded key in the environment.')
            return self.index, self.keys[self.index]

    def quota_exceeded(self, request_index):
        with self.lock:
            if self.index == request_index:
                self.index += 1
                if self.index < len(self.keys):
                    print(f'Quota exhausted for key slot {request_index + 1}; switching to slot {self.index + 1}.', flush=True)
            if self.index >= len(self.keys):
                STOP.set()
                raise RuntimeError('All configured key slots exhausted their quota. Add credits or resume with a funded key in the environment.')

    def redact(self, message):
        for key in self.keys:
            message = message.replace(key, '[redacted]')
        return message

def error_code(body):
    """Read the API's structured error code; free-form prose never triggers fallback."""
    try:
        payload = json.loads(body)
    except (ValueError, TypeError):
        return ''
    if not isinstance(payload, dict):
        return ''
    detail = payload.get('detail')
    detail = detail if isinstance(detail, dict) else {}
    for value in (detail.get('status'), detail.get('code'), payload.get('code'), payload.get('status')):
        if isinstance(value, str) and value:
            return value
    return ''

def estimate(catalog):
    pending = [clip for clip in catalog['clips']
               if not (ROOT / clip['file']).exists() or not valid_mp3((ROOT / clip['file']).read_bytes())]
    return {'totalClips': len(catalog['clips']), 'cachedClips': len(catalog['clips']) - len(pending),
            'pendingClips': len(pending), 'pendingCharacters': sum(len(clip['text']) for clip in pending)}

def generate(clip, catalog, key_pool):
    path = ROOT / clip['file']
    if path.exists() and valid_mp3(path.read_bytes()):
        return 'cached'
    if STOP.is_set():
        return 'stopped'
    data = json.dumps({'text': clip['text'], 'model_id': catalog['model'], 'language_code': 'en'}).encode()
    url = 'https://api.elevenlabs.io/v1/text-to-speech/' + catalog['voiceId'] + '?output_format=' + catalog['format']
    retries = 0
    while retries < 5:
        if STOP.is_set():
            return 'stopped'
        key_index, api_key = key_pool.current()
        req = urllib.request.Request(url, data=data, headers={'xi-api-key': api_key, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg'})
        try:
            with urllib.request.urlopen(req, timeout=120) as response:
                audio = response.read()
                if not valid_mp3(audio):
                    raise ValueError('Response was not valid MP3 audio')
                path.parent.mkdir(parents=True, exist_ok=True)
                temp = path.with_suffix('.mp3.part')
                temp.write_bytes(audio)
                temp.replace(path)
            return 'generated'
        except urllib.error.HTTPError as error:
            code = error_code(error.read())
            if code == 'quota_exceeded':
                key_pool.quota_exceeded(key_index)
                retries = 0
                continue
            # Rate limits retry the same slot; auth, permissions and network errors stop.
            if error.code == 429 and retries < 4:
                time.sleep(min(30, 2 ** (retries + 1)))
                retries += 1
                continue
            STOP.set()
            safe_code = code if code and len(code) <= 80 and all(c.isalnum() or c in '_-' for c in code) else 'request_failed'
            raise RuntimeError(key_pool.redact(f'HTTP {error.code} ({safe_code}) for {clip["key"]}. Stopped; fallback keys are used only for quota_exceeded.')) from None
        except Exception as error:
            STOP.set()
            raise RuntimeError(key_pool.redact(str(error))) from None
    raise RuntimeError('Rate limit retry budget exceeded')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workers', type=int, default=2)
    parser.add_argument('--assemble-only', action='store_true')
    parser.add_argument('--catalog', type=Path, default=CATALOG)
    parser.add_argument('--manifest', type=Path, default=MANIFEST)
    parser.add_argument('--estimate', action='store_true', help='Report pending clips and characters without API access or file changes.')
    args = parser.parse_args()
    catalog = json.loads(args.catalog.read_text())
    if args.estimate:
        print(json.dumps(estimate(catalog)), flush=True)
        return 0
    pack = assemble(catalog, args.manifest)
    if args.assemble_only or pack['complete']:
        print(json.dumps({k: pack[k] for k in ('count', 'expectedCount', 'bytes', 'complete')}), flush=True)
        return 0 if pack['complete'] else 1
    try:
        api_keys = read_api_keys()
    except ValueError as error:
        parser.error(str(error))
    if not api_keys:
        parser.error('Set ELEVENLABS_API_KEYS (ordered JSON array) or ELEVENLABS_API_KEY in your environment; never put keys into extension files.')
    key_pool = KeyPool(api_keys)
    total, done, generated, errors = len(catalog['clips']), 0, 0, []
    workers = max(1, min(2, args.workers))
    progress = estimate(catalog)
    generated_chars = 0
    print(f'Starting {total} clips, {pack["count"]} already saved, {workers} workers; {progress["pendingCharacters"]} pending characters; key slot 1.', flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        pending = {executor.submit(generate, clip, catalog, key_pool): clip for clip in catalog['clips']}
        for future in concurrent.futures.as_completed(pending):
            done += 1
            status = 'error'
            try:
                status = future.result()
                generated += status == 'generated'
                if status == 'generated':
                    generated_chars += len(pending[future]['text'])
            except Exception as error:
                STOP.set()
                errors.append(str(error))
                print(str(error), flush=True)
            if (not STOP.is_set() and status == 'generated' and generated % 10 == 0) or done == total:
                pack = assemble(catalog, args.manifest)
                print(f'Saved {pack["count"]}/{total}; generated this run {generated} clips / {generated_chars} characters; {pack["bytes"] / 1048576:.1f} MiB.', flush=True)
    pack = assemble(catalog, args.manifest)
    print(json.dumps({k: pack[k] for k in ('count', 'expectedCount', 'bytes', 'complete')}), flush=True)
    return 0 if pack['complete'] and not errors else 1

if __name__ == '__main__':
    raise SystemExit(main())
