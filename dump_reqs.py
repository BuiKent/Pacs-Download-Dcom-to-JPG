from playwright.sync_api import sync_playwright
import time
p = sync_playwright().start()
b = p.chromium.launch(headless=True, args=['--dns-over-https-mode=off'])
c = b.new_context(ignore_https_errors=True)
page = c.new_page()
requests = []
page.on('response', lambda r: requests.append(f"{r.headers.get('content-type', '')} ::: {r.url}"))
page.goto('http://viewer.bvdkht.vn/viewer?session=564f4e9d-7512-4a50-a944-b7139de59df8')
page.wait_for_timeout(10000)
with open('reqs.txt', 'w', encoding='utf-8') as f:
    f.write('\n'.join(requests))
b.close()
p.stop()
