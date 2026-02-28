import asyncio
from playwright.async_api import async_playwright

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto("http://localhost:3001")
        # Wait for the dashboard to load (wait for the services to appear)
        await page.wait_for_selector("text=Admin Dashboard", timeout=10000)
        
        # Login if needed
        login_btn = await page.query_selector("button:has-text('Access Dashboard')")
        if login_btn:
            await page.fill("input[placeholder='Admin ID']", "admin1")
            await page.fill("input[placeholder='Password']", "password123")
            await login_btn.click()
            await page.wait_for_selector("text=Total Requests", timeout=10000)
            
        await page.wait_for_timeout(2000) # Wait for polling to fetch revenue
        await page.screenshot(path="C:\\Users\\Sazid\\.gemini\\antigravity\\brain\\41001d6e-5fca-4311-9d29-e0a7cb00349e\\manual_screenshot.png")
        await browser.close()

asyncio.run(run())
