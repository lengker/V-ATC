import os
import sys
import asyncio
from pathlib import Path

# Enable the browser archive flow for this run.
os.environ["A2_LIVEATC_BROWSER_ARCHIVE_FLOW_ENABLED"] = "true"
os.environ["A2_LIVEATC_BROWSER_FLOW_TIMEOUT_SECONDS"] = "30"
# Use headed mode to allow challenge pages to clear if needed.
os.environ["A2_BROWSER_HEADLESS"] = "false"
os.environ["CLOAKBROWSER_CACHE_DIR"] = str((Path(__file__).resolve().parents[1] / ".cloakbrowser-cache").resolve())

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import app.db.models  # noqa: E402
from app.db.session import engine  # noqa: E402
from app.db.init_db import init_database  # noqa: E402
from app.services.ingestion_scheduler import LiveATCScheduler  # noqa: E402
from app.services.liveatc_client import LiveATCHTTPClient  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402


def debug_archive_flow(client: LiveATCHTTPClient) -> None:
    try:
        with sync_playwright() as playwright:
            context_result = client._new_browser_context(playwright)
            if isinstance(context_result, tuple):
                browser, context = context_result
                page = context.new_page()
            else:
                context = context_result
                browser = context_result
                page = context.pages[0] if context.pages else context.new_page()

            mount = client.mount_ids[0] if client.mount_ids else "vhhh5"
            archive_url = f"{client.base_url}/archive.php?m={mount}"
            page.goto(archive_url, wait_until="domcontentloaded", timeout=4_000)
            page.wait_for_timeout(20_000)
            html = page.content()
            title = page.title()
            print("page_title", title)
            print("page_url", page.url)
            print("challenge", "cf" in html.lower() or "just a moment" in html.lower())

            selects = page.locator("select")
            submit = page.locator("input[type='submit'], button[type='submit'], button", has_text="Submit").first
            print("select_count", selects.count(), "submit_count", submit.count())

            slot = client._last_finished_half_hour()
            target_date = slot.strftime("%Y%m%d")
            target_time = client._archive_time_label(slot)

            page.evaluate(
                                """
                                ({ value }) => {
                                    const visible = document.querySelector('#archiveDateDisplay');
                                    if (visible && visible._flatpickr) {
                                        visible._flatpickr.setDate(value, true, 'Ymd');
                                        return;
                                    }
                                    const hidden = document.querySelector('#archiveDate');
                                    if (hidden) {
                                        hidden.value = value;
                                        hidden.dispatchEvent(new Event('input', { bubbles: true }));
                                        hidden.dispatchEvent(new Event('change', { bubbles: true }));
                                    }
                                    if (visible) {
                                        visible.value = value;
                                        visible.dispatchEvent(new Event('input', { bubbles: true }));
                                        visible.dispatchEvent(new Event('change', { bubbles: true }));
                                    }
                                }
                                """,
                                {"value": target_date},
                        )

            time_select = page.locator("select[name='time']").first
            if time_select.count():
                try:
                    time_select.select_option(label=target_time)
                except Exception:
                    print("time_option_missing", target_time)
                    return
            if submit.count():
                submit.click()
            else:
                page.keyboard.press("Enter")
            page.wait_for_timeout(2000)

            html = page.content()
            link = client._historical_audio_link_from_html(html, page.url)
            print("mp3_link", link.url if link else None)
            print("mp3_marker", ".mp3" in html.lower())
    except Exception as exc:
        print("debug_archive_flow_error", type(exc).__name__, str(exc))


async def run_once() -> None:
    await init_database(engine)

    client = LiveATCHTTPClient()
    link = await asyncio.to_thread(client._browser_archive_flow_link, "VHHH")
    print("browser_link", link.url if link else None)
    if link:
        status, body = client._browser_fetch_bytes(link.url, referer=link.referer_url)
        print("browser_fetch_status", status, "bytes", len(body), "magic", body[:8])
    else:
        await asyncio.to_thread(debug_archive_flow, client)

    scheduler = LiveATCScheduler()
    downloaded = await scheduler.trigger_historical_once()
    print("downloaded", downloaded)
    print("status", scheduler.status())


if __name__ == "__main__":
    asyncio.run(run_once())
