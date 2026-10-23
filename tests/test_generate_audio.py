"""Offline generator checks; every HTTP request is mocked."""
import concurrent.futures
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest import mock
import urllib.error

SPEC = importlib.util.spec_from_file_location('generate_audio', Path(__file__).resolve().parents[1] / 'tools/generate_audio.py')
generator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(generator)
MP3 = b'ID3' + b'\x00' * 600


class Response:
    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def read(self):
        return MP3


def http_error(status, code=None, message=''):
    detail = {'message': message}
    if code is not None:
        detail['status'] = code
    return urllib.error.HTTPError('https://api.elevenlabs.io/test', status, 'failure', {},
                                 io.BytesIO(json.dumps({'detail': detail}).encode()))


class GeneratorTests(unittest.TestCase):
    def setUp(self):
        generator.STOP.clear()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        patch = mock.patch.object(generator, 'ROOT', self.root)
        patch.start()
        self.addCleanup(patch.stop)
        self.clip = {'key': 'vo_test', 'file': 'audio/vo_test.mp3', 'text': '[softly] Eyes up.',
                     'title': 'Eyes up', 'category': 'rest'}
        self.catalog = {'voiceId': 'requested-voice', 'model': 'requested-model', 'format': 'mp3_44100_128',
                        'clips': [self.clip]}

    def test_keys_preserve_environment_order_without_plaintext_files(self):
        self.assertEqual(generator.read_api_keys({'ELEVENLABS_API_KEYS': '["first", "second"]',
                                                  'ELEVENLABS_API_KEY': 'legacy'}), ['first', 'second'])
        self.assertEqual(generator.read_api_keys({'ELEVENLABS_API_KEY': 'legacy'}), ['legacy'])
        self.assertEqual(generator.read_api_keys({}), [])
        for invalid in ['not-json', '[]', '{}', '["key", 1]', '[""]']:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                generator.read_api_keys({'ELEVENLABS_API_KEYS': invalid, 'ELEVENLABS_API_KEY': 'legacy'})
        self.assertEqual(list(self.root.iterdir()), [])

    def test_only_structured_quota_exhaustion_switches_slots_and_preserves_request(self):
        pool = generator.KeyPool(['secret-first', 'secret-second'])
        calls = []

        def request(req, timeout):
            calls.append(req)
            self.assertEqual(timeout, 120)
            if len(calls) == 1:
                raise http_error(429, 'quota_exceeded')
            return Response()

        output = io.StringIO()
        with mock.patch.object(generator.urllib.request, 'urlopen', side_effect=request), contextlib.redirect_stdout(output):
            self.assertEqual(generator.generate(self.clip, self.catalog, pool), 'generated')
        self.assertEqual([req.get_header('Xi-api-key') for req in calls], ['secret-first', 'secret-second'])
        self.assertEqual(json.loads(calls[0].data), {'text': self.clip['text'], 'model_id': 'requested-model', 'language_code': 'en'})
        self.assertEqual(calls[0].full_url, 'https://api.elevenlabs.io/v1/text-to-speech/requested-voice?output_format=mp3_44100_128')
        self.assertIn('key slot 1; switching to slot 2', output.getvalue())
        self.assertNotIn('secret-', output.getvalue())
        self.assertEqual((self.root / self.clip['file']).read_bytes(), MP3)

    def test_auth_permissions_network_and_message_only_quota_never_use_fallback(self):
        for error in [http_error(401, 'invalid_api_key'), http_error(403, 'missing_permissions'),
                      http_error(400, 'invalid_request', 'quota_exceeded'),
                      urllib.error.URLError('network unavailable')]:
            with self.subTest(error=error):
                generator.STOP.clear()
                pool = generator.KeyPool(['first-secret', 'second-secret'])
                with mock.patch.object(generator.urllib.request, 'urlopen', side_effect=error) as request:
                    with self.assertRaises(RuntimeError) as raised:
                        generator.generate(self.clip, self.catalog, pool)
                self.assertEqual(pool.index, 0)
                self.assertEqual(request.call_count, 1)
                self.assertNotIn('first-secret', str(raised.exception))
                self.assertNotIn('second-secret', str(raised.exception))
                self.assertTrue(generator.STOP.is_set())

    def test_429_retries_same_slot_without_fallback(self):
        pool = generator.KeyPool(['first', 'second'])
        with mock.patch.object(generator.urllib.request, 'urlopen', side_effect=[http_error(429, 'rate_limit_exceeded'), Response()]) as request, \
                mock.patch.object(generator.time, 'sleep') as sleep:
            self.assertEqual(generator.generate(self.clip, self.catalog, pool), 'generated')
        self.assertEqual(pool.index, 0)
        self.assertEqual([call.args[0].get_header('Xi-api-key') for call in request.call_args_list], ['first', 'first'])
        sleep.assert_called_once_with(2)

    def test_simultaneous_quota_responses_advance_only_once_and_keep_second_slot(self):
        pool = generator.KeyPool(['secret-one', 'secret-two', 'secret-three'])
        barrier = threading.Barrier(2)
        calls = []
        lock = threading.Lock()

        def request(req, timeout):
            key = req.get_header('Xi-api-key')
            with lock:
                calls.append(key)
            if key == 'secret-one':
                barrier.wait(timeout=5)
                raise http_error(400, 'quota_exceeded')
            return Response()

        other = {**self.clip, 'key': 'vo_other', 'file': 'audio/vo_other.mp3'}
        output = io.StringIO()
        with mock.patch.object(generator.urllib.request, 'urlopen', side_effect=request), contextlib.redirect_stdout(output), \
                concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda clip: generator.generate(clip, self.catalog, pool), [self.clip, other]))
        self.assertEqual(results, ['generated', 'generated'])
        self.assertEqual(pool.index, 1)
        self.assertEqual(calls.count('secret-one'), 2)
        self.assertEqual(calls.count('secret-two'), 2)
        self.assertNotIn('secret-three', calls)
        self.assertEqual(output.getvalue().count('switching'), 1)
        self.assertNotIn('secret-', output.getvalue())

    def test_exhausted_last_slot_stops_with_actionable_secret_free_error(self):
        pool = generator.KeyPool(['only-secret'])
        with mock.patch.object(generator.urllib.request, 'urlopen', side_effect=http_error(400, 'quota_exceeded')):
            with self.assertRaisesRegex(RuntimeError, 'Add credits or resume') as raised:
                generator.generate(self.clip, self.catalog, pool)
        self.assertNotIn('only-secret', str(raised.exception))
        self.assertTrue(generator.STOP.is_set())

    def test_cached_files_reused_and_custom_manifest_preserves_metadata(self):
        path = self.root / self.clip['file']
        path.parent.mkdir()
        path.write_bytes(MP3)
        with mock.patch.object(generator.urllib.request, 'urlopen') as request:
            self.assertEqual(generator.generate(self.clip, self.catalog, generator.KeyPool([])), 'cached')
        request.assert_not_called()
        manifest = self.root / 'custom/manifest.json'
        pack = generator.assemble(self.catalog, manifest)
        self.assertTrue(pack['complete'])
        self.assertEqual(pack['clips']['vo_test']['title'], 'Eyes up')
        self.assertEqual(pack['clips']['vo_test']['category'], 'rest')
        self.assertEqual(pack['clips']['vo_test']['bytes'], len(MP3))
        self.assertEqual(json.loads(manifest.read_text()), pack)

    def test_estimate_custom_catalog_makes_no_network_calls_or_writes(self):
        catalog_path = self.root / 'batch.json'
        catalog_path.write_text(json.dumps(self.catalog))
        manifest = self.root / 'should-not-exist/manifest.json'
        output = io.StringIO()
        with mock.patch('sys.argv', ['generate_audio.py', '--catalog', str(catalog_path), '--manifest', str(manifest), '--estimate']), \
                mock.patch.object(generator.urllib.request, 'urlopen') as request, contextlib.redirect_stdout(output):
            self.assertEqual(generator.main(), 0)
        request.assert_not_called()
        self.assertFalse(manifest.exists())
        self.assertEqual(list(self.root.iterdir()), [catalog_path])
        self.assertEqual(json.loads(output.getvalue()), {'totalClips': 1, 'cachedClips': 0, 'pendingClips': 1,
                                                         'pendingCharacters': len(self.clip['text'])})


if __name__ == '__main__':
    unittest.main()
