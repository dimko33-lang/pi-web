#!/usr/bin/env python3
"""Offline web_read readiness fixtures. Use the web worker's Playwright environment."""
import argparse
import asyncio
import importlib.util
from pathlib import Path
from playwright.async_api import async_playwright


async def checks(worker):
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        try:
            page = await browser.new_page()
            # Fulfilled in memory. Never fetch external pages in this suite.
            doc = {'content_type': 'text/html', 'body': ''}
            await page.context.route('**/*', lambda route: route.fulfill(**doc))
            async def open_doc(html, url='https://fixture.invalid/', mime='text/html'):
                doc.update(body=html, content_type=mime)
                await page.goto(url, wait_until='domcontentloaded')
                return url

            async def content_text(page, url, timeout_ms):
                result = await worker.page_result(page, url, timeout_ms)
                if 'error' in result:
                    assert result['status'] == 'no_readable_content' and 'text' not in result and 'links' not in result
                    return None
                return result['text']

            # A readable, static page succeeds even with a budget below the old fixed sleep.
            url = await open_doc('<nav>Controls</nav><main><h1>Report</h1><p>All systems ready.</p></main>')
            assert await content_text(page, url, 500) == 'Report\n\nAll systems ready.'
            for mime in ('text/html', 'text/plain'):
                url = await open_doc('42', mime=mime)
                assert await content_text(page, url, 500) == '42'
            # A long menu, hidden prose and a cookie dialog are not positive signals.
            shell = ('<header>Site navigation and important information about this website.</header>'
                     '<main><p>Loading…</p><article hidden><p>Secret hidden article never rendered.</p></article></main>'
                     '<dialog open>We would love to send you notifications and relevant offers.</dialog>')
            url = await open_doc(shell)
            assert await content_text(page, url, 500) is None
            # Delayed text is picked up without requiring network-idle or changes to the request guard.
            await page.evaluate("() => setTimeout(() => document.querySelector('main').innerHTML='<p>The delayed document has arrived.</p>', 650)")
            assert await content_text(page, url, 3000) == 'The delayed document has arrived.'
            url = await open_doc('<main aria-busy="true"><p>A temporary preview in a busy main region.</p></main><p>Long decorative text outside the requested region.</p>')
            assert await content_text(page, url, 400) is None
            # A share shell itself contains prose in main. Only rendered conversation/document regions qualify.
            for path in ('/share/sample', '/s/sample'):
                url = await open_doc('<main><p>This is a public copy of a shared conversation.</p><ol></ol></main>',
                                     'https://chatgpt.com' + path)
                assert await content_text(page, url, 350) is None
                await page.evaluate("() => document.querySelector('ol').innerHTML='<li><section><h1>Document</h1><p>First paragraph of the actual document.</p></section></li>'")
                text = await content_text(page, url, 700)
                assert text.startswith('Document') and 'actual document' in text and 'public copy' not in text
            url = await open_doc('<main><article><div data-message-author-role="user">Hi</div></article><article><div data-message-author-role="assistant">Hello!</div></article></main>', 'https://chatgpt.com/share/sample')
            assert await content_text(page, url, 700) == 'Hi\n\nHello!'
            url = await open_doc('<main><p>' + 'word '*15000 + '</p></main>')
            result = await worker.page_result(page, url, 1000)
            assert result['truncated'] and result['returned_chars'] == 60000 and result['total_chars'] == 74999
        finally:
            await browser.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--worker', type=Path, default=Path(__file__).resolve().parents[1]/'rootfs/opt/nikita-web/web_worker.py')
    spec = importlib.util.spec_from_file_location('worker_under_test', parser.parse_args().worker)
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    asyncio.run(checks(worker))
    print('Readiness fixtures passed: fast, delayed, UI only, busy/hidden, shared documents and turns, plaintext, truncation.')
