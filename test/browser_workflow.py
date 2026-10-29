#!/usr/bin/env python3
"""Real Chromium smoke: UI -> mock model -> approved patches -> real npm test fail/repair.
Uses only a synthetic, trusted fixture; local host execution is NEVER suitable for
untrusted repositories. Requires pip install playwright and installed Chromium.
"""
import contextlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ACTIONS = [
    {'tool': 'list_files'},
    {'tool': 'read_file', 'path': 'src/math.js'},
    {'tool': 'patch_file', 'path': 'src/math.js', 'find': 'return a - b;', 'replace': 'return a * b;', 'reason': 'First attempt (deliberately wrong, to test the repair loop)'},
    {'tool': 'npm_test'},
    {'tool': 'patch_file', 'path': 'src/math.js', 'find': 'return a * b;', 'replace': 'return a + b;', 'reason': 'Repair the failed addition contract test'},
    {'tool': 'npm_test'},
    {'done': True, 'message': 'Repaired addition, observed a failing test, and then passed npm test.'},
]

def port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]

def api(url, payload=None, method='GET'):
    data = None if payload is None else json.dumps(payload).encode('utf8')
    req = urllib.request.Request(url, data=data, method=method, headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.load(response)

class Model(BaseHTTPRequestHandler):
    count = 0
    def log_message(self, *args):
        pass
    def do_POST(self):
        if self.path != '/v1/chat/completions':
            self.send_error(404)
            return
        size = int(self.headers.get('Content-Length','0'))
        body = json.loads(self.rfile.read(size).decode())
        assert body['model'] == 'mock-coder'
        assert self.headers['Authorization'] == 'Bearer arena-browser-test'
        n = Model.count
        Model.count += 1
        action = ACTIONS[min(n, len(ACTIONS)-1)]
        payload = json.dumps({'choices':[{'message':{'content':json.dumps(action)}}]}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

def main():
    chromium_binary = os.environ.get('CHROMIUM_BINARY') or shutil.which('chromium') or shutil.which('google-chrome')
    with tempfile.TemporaryDirectory(prefix='arena-browser-e2e-') as temp:
        temp = Path(temp)
        for f in ('server.js','zip-utils.cjs'):
            shutil.copy(ROOT/f, temp/f)
        shutil.copytree(ROOT/'public',temp/'public',ignore=shutil.ignore_patterns('vendor'))
        (temp/'data').mkdir()
        hosted = ThreadingHTTPServer(('127.0.0.1', port()), Model)
        thread = threading.Thread(target=hosted.serve_forever,daemon=True)
        thread.start()
        webport = port()
        env = {**os.environ,'HOST':'127.0.0.1','PORT':str(webport), 'AI_API_KEY':'arena-browser-test',
               'AI_MODELS':'mock-coder','AI_BASE_URL':f'http://127.0.0.1:{hosted.server_port}/v1',
               'ARENA_EXECUTION_BACKEND':'host','NODE_ENV':'test'}
        server = subprocess.Popen(['node','server.js'],cwd=temp,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        try:
            base = f'http://127.0.0.1:{webport}'
            for _ in range(100):
                try:
                    if api(base+'/api/status')['providerConfigured']:
                        break
                except Exception:
                    pass
                if server.poll() is not None:
                    raise AssertionError('Arena server exited before becoming ready')
                time.sleep(0.08)
            else:
                raise AssertionError('Arena server did not start')
            created = api(base+'/api/projects',{'name':'Browser Agent Repair'},'POST')['project']
            ident = created['id']
            files = {
                'package.json': json.dumps({'scripts': {'test': 'node --test test/*.test.js'}}),
                'src/math.js': 'module.exports = (a, b) => { return a - b; };\n',
                'test/math.test.js': "const test=require('node:test');const assert=require('node:assert/strict');const add=require('../src/math');test('addition',()=>assert.equal(add(2,3),5));\n",
            }
            for name,content in files.items():
                api(base+f'/api/projects/{ident}/file',{'path':name,'content':content},'PUT')
            dialogs = []
            exceptions = []
            with sync_playwright() as p:
                options = {'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
                if chromium_binary:
                    options['executable_path'] = chromium_binary
                browser=p.chromium.launch(**options)
                page=browser.new_page(viewport={'width': 1440,'height': 900})
                page.on('pageerror',lambda error:exceptions.append(str(error)))
                def accept(dialog):
                    dialogs.append({'type':dialog.type,'message':dialog.message[:180]})
                    dialog.accept()
                page.on('dialog',accept)
                page.goto(base,wait_until='domcontentloaded')
                page.evaluate('() => window.arenaOpenProjectHub()')
                page.locator(f'button[data-project="{ident}"]').click()
                page.locator('#projectTask').fill('Fix the addition bug and verify with tests.')
                page.locator('#projectAgentRun').click()
                page.wait_for_function('''() => document.querySelector('#projectAgentLog')?.textContent?.includes('Finished (tests passed)')''',timeout=90_000)
                log=page.locator('#projectAgentLog').inner_text()
                assert not exceptions, f'Browser JS errors: {exceptions}'
                assert 'npm_test → needs attention' in log, log
                assert 'npm_test → success' in log, log
                assert len([x for x in dialogs if x['type']=='confirm']) >= 4, dialogs
                browser.close()
            changed = api(base+f'/api/projects/{ident}/file?path=src%2Fmath.js')
            assert 'return a + b;' in changed['content'], changed
            assert Model.count >= len(ACTIONS), Model.count
            final=api(base+f'/api/projects/{ident}/run',{'action':'npm-test'},'POST')
            assert final['ok'] is True, final
            print(json.dumps({'ok':True,'browser':'Chromium','provider':'mock (no external AI)','modelCalls':Model.count,
                              'confirmDialogs':len(dialogs),'failingTestObserved':True,
                              'repairApplied':True,'finalNpmTestPassed':True}))
        finally:
            server.terminate()
            try:
                server.communicate(timeout=4)
            except subprocess.TimeoutExpired:
                server.kill()
            hosted.shutdown()
            hosted.server_close()
if __name__ == '__main__':
    main()
