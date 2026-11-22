"""Headless Chrome (SwiftShader WebGL) test driver.
usage: python3 tools/shot.py URL script.json
script: list of steps: {"wait": ms} | {"eval": js} | {"shot": path} | {"down": code} | {"up": code} | {"press": code}
        {"mouse": [dx, dy]} | {"click": [x, y]} | {"waitFor": js_expr, "timeout": ms}
"""
import sys, json, asyncio
from playwright.async_api import async_playwright

async def main(url, steps, w=1280, h=720):
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True,
            args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
                  '--enable-webgl', '--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width': w, 'height': h})
        msgs = []
        pg.on('console', lambda m: msgs.append(f'[{m.type}] {m.text}'))
        pg.on('pageerror', lambda e: msgs.append(f'[PAGEERROR] {e}'))
        await pg.goto(url, wait_until='load', timeout=120000)
        for st in steps:
            if 'wait' in st: await pg.wait_for_timeout(st['wait'])
            elif 'waitFor' in st:
                try: await pg.wait_for_function(st['waitFor'], timeout=st.get('timeout', 60000))
                except Exception as e: msgs.append(f'[waitFor timeout] {st["waitFor"]}')
            elif 'eval' in st:
                try:
                    r = await pg.evaluate(st['eval'])
                    if r is not None: msgs.append(f'[eval] {json.dumps(r)[:2000]}')
                except Exception as e: msgs.append(f'[eval error] {e}')
            elif 'shot' in st:
                try: await pg.screenshot(path=st['shot'], timeout=120000)
                except Exception as e: msgs.append(f'[shot failed] {st["shot"]}: {str(e)[:120]}')
            elif 'down' in st: await pg.keyboard.down(st['down'])
            elif 'up' in st: await pg.keyboard.up(st['up'])
            elif 'press' in st: await pg.keyboard.press(st['press'])
            elif 'click' in st: await pg.mouse.click(st['click'][0], st['click'][1])
        for m in msgs[-60:]: print(m[:4000])
        await b.close()

if __name__ == '__main__':
    url = sys.argv[1]
    steps = json.loads(open(sys.argv[2]).read()) if len(sys.argv) > 2 and sys.argv[2].endswith('.json') else json.loads(sys.argv[2]) if len(sys.argv) > 2 else [{"wait": 4000}, {"shot": "/home/claude/shots/a.png"}]
    w = int(sys.argv[3]) if len(sys.argv) > 3 else 1280
    h = int(sys.argv[4]) if len(sys.argv) > 4 else 720
    asyncio.run(main(url, steps, w, h))
