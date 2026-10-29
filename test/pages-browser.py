"""Chromium UI smoke test of the real GitHub Pages artifact, with no network or backend.
Run: python3 test/pages-browser.py; needs Playwright and a local Chromium installation.
"""
from playwright.sync_api import sync_playwright
from pathlib import Path
import re, os, threading, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import Error as PlaywrightError
ROOT = Path(__file__).resolve().parents[1] / 'dist/pages'
html = (ROOT / 'index.html').read_text(encoding='utf-8')
html = re.sub(r'<link rel="stylesheet" href="\./[^"]+">', '', html)
html = re.sub(r'<script src="\./[^"]+"></script>', '', html)
# Serving from localhost avoids Chromium's about:blank + opaque iframe navigation bug
# on GitHub Actions. Restricted local environments can use the inline fallback.
class SilentHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
handler = functools.partial(SilentHandler, directory=str(ROOT))
server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
 with sync_playwright() as p:
    installed_chromium = os.getenv('ARENA_CHROMIUM', '/usr/bin/chromium')
    binary = installed_chromium if Path(installed_chromium).is_file() else None
    browser = p.chromium.launch(headless=True, executable_path=binary, args=['--no-sandbox','--disable-dev-shm-usage'])
    page = browser.new_page(viewport={'width': 1330, 'height': 900}, accept_downloads=True)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('dialog', lambda dialog: dialog.accept())
    try:
        page.goto(f'http://127.0.0.1:{server.server_port}/', wait_until='domcontentloaded', timeout=8000)
        page.locator('#pagesWorkspaceBtn').wait_for(timeout=5000)
        print('Using real localhost HTTP origin for Chromium smoke test')
    except PlaywrightError:
        print('Localhost navigation blocked; using inline DOM fallback')
        page.close()
        page = browser.new_page(viewport={'width': 1330, 'height': 900}, accept_downloads=True)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('dialog', lambda dialog: dialog.accept())
        page.set_content(html, wait_until='domcontentloaded')
        # about:blank cannot write persistent storage in locked-down environments.
        page.evaluate("""() => {const data = new Map(); Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k),clear:()=>data.clear()}})}""")
        for src in ['pages-static.js','app.js','templates.js','studio.js','browser-core.js','browser-workspace.js']:
            page.add_script_tag(content=(ROOT/src).read_text(encoding='utf-8'))
        for style in ['style.css','studio.css','pages-static.css']:
            page.add_style_tag(content=(ROOT/style).read_text(encoding='utf-8'))
        page.evaluate("window.crypto.randomUUID ||= () => 'smoke-' + Math.random().toString(36).slice(2)")
        page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.locator('#pagesWorkspaceBtn').wait_for(timeout=5000)
    page.locator('#pagesWorkspaceBtn').click()
    assert page.locator('#arenaLocalDialog').evaluate('(e)=>e.open') is True
    assert page.locator('.arena-local-file').count() == 3
    assert page.locator('#arenaLocalCode').input_value().startswith('<!doctype html>')
    page.locator('[data-action="check"]').click()
    assert 'Basic syntax checks completed' in page.locator('#arenaLocalStatus').inner_text()
    page.locator('.arena-local-file[data-path="app.js"]').click()
    page.locator('#arenaLocalCode').fill('const broken = ;')
    page.locator('[data-action="save"]').click()
    page.locator('[data-action="check"]').click()
    assert 'syntax check(s) failed' in page.locator('#arenaLocalStatus').inner_text()
    page.locator('[data-action="restore"]').click()
    assert page.locator('#arenaLocalCode').input_value().startswith('document.querySelector')
    page.locator('[data-action="check"]').click()
    assert 'Basic syntax checks completed' in page.locator('#arenaLocalStatus').inner_text()
    page.locator('[data-action="preview"]').click()
    page.frame_locator('#arenaLocalFrame').locator('h1').wait_for(timeout=5000)
    assert page.frame_locator('#arenaLocalFrame').locator('h1').inner_text().startswith('Hello')
    page.frame_locator('#arenaLocalFrame').locator('#hello').click()
    assert 'It works!' in page.frame_locator('#arenaLocalFrame').locator('h1').inner_text()
    # A deterministic *mock* WebLLM response exercises approval, multi-file edits, and undo.
    # This validates UI wiring, not a real coding model's quality.
    page.evaluate("""() => {studio.ready=true;studio.engine={chat:{completions:{create:async ()=>({choices:[{message:{content:JSON.stringify({summary:'Add a second heading',changes:[{path:'index.html',content:'<!doctype html><html><body><h1>Mock AI approved change</h1><script src="app.js"></script></body></html>'},{path:'extra.js',content:'const verified = true;'}]})}}]})}}}}""")
    page.locator('#arenaLocalTask').fill('Add a second heading')
    page.locator('[data-action="agent"]').click()
    page.get_by_text('Review every proposed AI file change').wait_for(timeout=5000)
    assert page.locator('.arena-review-files details').count() == 2
    assert page.locator('.arena-local-file[data-path="extra.js"]').count() == 0
    page.get_by_role('button', name='Approve 2 changes').click()
    page.locator('.arena-local-file[data-path="extra.js"]').wait_for(timeout=5000)
    page.locator('[data-action="restore"]').click()
    assert page.locator('.arena-local-file[data-path="extra.js"]').count() == 0
    assert 'Hello from Arena' in page.evaluate('JSON.parse(localStorage.getItem("arena-pages-workspace-v1")).files["index.html"]')
    with page.expect_download(timeout=5000) as item:
        page.locator('[data-action="export"]').click()
    assert item.value.suggested_filename.endswith('.zip')
    page.locator('[data-action="close"]').click()
    page.locator('#templatesBtn').click()
    page.locator('.template-card').first.click()
    assert page.locator('#codeEditor').count() == 1
    assert not errors, errors
    print('Browser workflow passed: local project edit → syntax failure → undo → preview → ZIP export → Starter Lab')
    browser.close()
finally:
    server.shutdown()
