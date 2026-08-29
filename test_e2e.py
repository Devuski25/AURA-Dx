"""COUGHPH E2E Functional Audit â€” tests all routes, buttons, forms, and console errors."""
import json, time, sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:5174"
RESULTS = {"routes": [], "errors": [], "console_errors": [], "network_errors": [], "broken_buttons": [], "mobile": []}

def log(msg, level="INFO"):
    print(f"[{level}] {msg}")

def test_route(page, url, name, expect_status=200):
    """Navigate to a route and check for errors."""
    console_errors = []
    network_errors = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
    page.on("response", lambda resp: network_errors.append(f"{resp.status} {resp.url}") if resp.status >= 400 else None)
    
    try:
        resp = page.goto(f"{BASE}{url}", wait_until="networkidle", timeout=15000)
        status = resp.status if resp else 0
        title = page.title()
        page.wait_for_timeout(1000)  # let any lazy JS settle
        
        # Collect all interactive elements
        buttons = page.locator("button, [role='button'], a[href]").count()
        inputs = page.locator("input, textarea, select").count()
        
        result = {
            "url": url, "name": name, "status": status, "title": title,
            "buttons": buttons, "inputs": inputs,
            "console_errors": console_errors, "network_errors": network_errors,
            "passed": status == expect_status
        }
        RESULTS["routes"].append(result)
        RESULTS["console_errors"].extend([f"{url}: {e}" for e in console_errors])
        RESULTS["network_errors"].extend([f"{url}: {e}" for e in network_errors])
        
        icon = "[OK]" if result["passed"] else "[FAIL]"
        log(f"{icon} {name} ({url}) -- status={status}, buttons={buttons}, inputs={inputs}")
        if console_errors:
            log(f"  Console errors: {console_errors}", "WARN")
        if network_errors:
            log(f"  Network errors: {network_errors}", "WARN")
        return result
    except Exception as e:
        log(f"âœ-- {name} ({url}) â€” FAILED: {e}", "ERROR")
        RESULTS["errors"].append(f"{url}: {e}")
        return None

def test_button(page, selector, name, expect_action="click"):
    """Click a button and check for errors."""
    try:
        btn = page.locator(selector).first
        if btn.is_visible():
            btn.click()
            page.wait_for_timeout(500)
            log(f"  âœ“ Button '{name}' clicked")
            return True
        else:
            log(f"  â--‹ Button '{name}' not visible (skipped)", "WARN")
            return False
    except Exception as e:
        log(f"  âœ-- Button '{name}' failed: {e}", "ERROR")
        RESULTS["broken_buttons"].append(f"{name}: {e}")
        return False

def test_mobile(browser, base):
    """Mobile responsiveness at 375x812 — assert no horizontal overflow on public + auth routes, and that the public nav toggle works."""
    mobile = browser.new_context(
        viewport={"width": 375, "height": 812}, is_mobile=True, has_touch=True, device_scale_factor=1
    )
    mp = mobile.new_page()

    routes = [
        ("/", "Home"),
        ("/about", "About"),
        ("/team", "Team"),
        ("/legal", "Legal"),
        ("/login", "Login"),
        ("/register", "Register"),
        ("/reset-password", "Reset Password"),
        ("/auth/callback", "Auth Callback"),
    ]

    for url, name in routes:
        console_errors = []
        mp.on("console", lambda msg, ce=console_errors: ce.append(msg.text) if msg.type == "error" else None)
        try:
            mp.goto(f"{base}{url}", wait_until="networkidle", timeout=15000)
            mp.wait_for_timeout(800)
            data = mp.evaluate(
                """() => {
                    const w = window.innerWidth;
                    const els = [];
                    document.querySelectorAll('*').forEach(el => {
                        const r = el.getBoundingClientRect();
                        if (r.width === 0 && r.height === 0) return;
                        const cs = getComputedStyle(el);
                        if (cs.position === 'fixed') return;
                        if (r.right > w + 1 || r.left < -1) {
                            els.push({tag: el.tagName, cls: String(el.className).slice(0, 90), right: Math.round(r.right), left: Math.round(r.left)});
                        }
                    });
                    return { scrollW: document.documentElement.scrollWidth, innerW: w, els: els.slice(0, 4) };
                }"""
            )
            overflow = data["scrollW"] > data["innerW"] + 1 or len(data["els"]) > 0
            RESULTS["mobile"].append({
                "url": url, "name": name, "overflow": overflow,
                "scrollW": data["scrollW"], "innerW": data["innerW"],
                "elements": data["els"], "console_errors": console_errors,
            })
            if overflow:
                log(f"  [FAIL] {name} ({url}) -- horizontal overflow (scrollW={data['scrollW']} > innerW={data['innerW']})")
                for e in data["els"]:
                    log(f"    <{e['tag']}> {e['cls']} right={e['right']} left={e['left']}", "WARN")
            else:
                log(f"  [OK] {name} ({url}) -- no horizontal overflow")
        except Exception as e:
            RESULTS["mobile"].append({"url": url, "name": name, "overflow": True, "elements": [], "error": str(e)})
            log(f"  [FAIL] {name} ({url}) -- {e}", "ERROR")

    # Public nav toggle on mobile
    try:
        mp.goto(f"{base}/", wait_until="networkidle")
        mp.wait_for_timeout(600)
        toggle = mp.locator("button[aria-label='Toggle navigation']").first
        if toggle.is_visible():
            log("  [OK] Mobile nav toggle visible on 375px")
            toggle.click()
            mp.wait_for_timeout(400)
            first_link = mp.locator("nav a").first
            opened = first_link.is_visible()
            RESULTS["mobile"].append({"test": "nav_toggle", "opened": opened})
            log(f"  {'[OK]' if opened else '[FAIL]'} Mobile nav opens after toggle")
            toggle.click()
            mp.wait_for_timeout(300)
            closed = not first_link.is_visible()
            RESULTS["mobile"].append({"test": "nav_close", "closed": closed})
            log(f"  {'[OK]' if closed else '[FAIL]'} Mobile nav closes after second toggle")
        else:
            log("  [FAIL] Mobile nav toggle NOT visible on 375px", "ERROR")
    except Exception as e:
        log(f"  [FAIL] Mobile nav toggle test: {e}", "ERROR")

    mobile.close()

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        
        log("=" * 60)
        log("COUGHPH E2E FUNCTIONAL AUDIT")
        log("=" * 60)
        
        # ================================================================
        # 1. PUBLIC PAGES
        # ================================================================
        log("\n--- PUBLIC PAGES ---")
        test_route(page, "/", "Home")
        test_route(page, "/about", "About")
        test_route(page, "/team", "Team")
        test_route(page, "/legal", "Legal")
        
        # Test nav links on home page
        page.goto(f"{BASE}/", wait_until="networkidle")
        page.wait_for_timeout(500)
        nav_links = page.locator("nav a, header a").all()
        log(f"  Found {len(nav_links)} nav links")
        for link in nav_links[:10]:
            href = link.get_attribute("href")
            text = link.inner_text().strip()
            if href and text:
                log(f"    Link: '{text}' â†’ {href}")
        
        # ================================================================
        # 2. AUTH PAGES â€” LOGIN
        # ================================================================
        log("\n--- AUTH PAGES: LOGIN ---")
        test_route(page, "/login", "Login")
        
        # Test login form elements
        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.wait_for_timeout(500)
        
        email_input = page.locator("input[type='email'], input[name='email'], input[placeholder*='email' i]").first
        pass_input = page.locator("input[type='password'], input[name='password']").first
        
        if email_input.is_visible():
            log("  âœ“ Email input found")
            # Test empty submission
            submit_btn = page.locator("button[type='submit']").first
            if submit_btn.is_visible():
                submit_btn.click()
                page.wait_for_timeout(1000)
                # Check for validation messages
                errors = page.locator("[role='alert'], .text-red-600, .text-destructive").all()
                log(f"  Validation errors after empty submit: {len(errors)}")
        else:
            log("  âœ-- Email input NOT found", "ERROR")
        
        if pass_input.is_visible():
            log("  âœ“ Password input found")
        else:
            log("  âœ-- Password input NOT found", "ERROR")
        
        # Test "Forgot Password?" link
        forgot_link = page.locator("text=Forgot password").first
        if forgot_link.is_visible():
            log("  âœ“ 'Forgot password' link found")
            forgot_link.click()
            page.wait_for_timeout(1000)
            current_url = page.url
            log(f"    After click URL: {current_url}")
            if "login" in current_url:
                # It likely opened the forgot password dialog
                dialog_email = page.locator("input[type='email'], input[placeholder*='email' i]").first
                if dialog_email.is_visible():
                    log("    âœ“ Forgot password dialog appeared with email input")
                else:
                    log("    âœ-- Forgot password dialog missing email input", "WARN")
            elif "reset" in current_url:
                log("    âœ“ Navigated to reset password page")
        else:
            log("  âœ-- 'Forgot password' link NOT found", "ERROR")
        
        # Test Google OAuth button
        google_btn = page.locator("text=Continue with Google").first
        if google_btn.is_visible():
            log("  âœ“ Google OAuth button found")
        else:
            log("  â--‹ Google OAuth button not visible", "WARN")
        
        # Test "Create one" link to register
        register_link = page.locator("text=Create one").first
        if register_link.is_visible():
            log("  âœ“ 'Create one' register link found")
        
        # ================================================================
        # 3. AUTH PAGES â€” REGISTER
        # ================================================================
        log("\n--- AUTH PAGES: REGISTER ---")
        test_route(page, "/register", "Register")
        
        page.goto(f"{BASE}/register", wait_until="networkidle")
        page.wait_for_timeout(500)
        
        # Check all form fields exist
        fields = {
            "Full Name": "input[name='full_name'], input[placeholder*='name' i]",
            "Email": "input[type='email'], input[name='email']",
            "Phone": "input[type='tel'], input[name='phone']",
            "Password": "input[type='password'], input[name='password']",
        }
        for field_name, selector in fields.items():
            el = page.locator(selector).first
            if el.is_visible():
                log(f"  âœ“ {field_name} input found")
            else:
                log(f"  âœ-- {field_name} input NOT found", "ERROR")
        
        # Check OTP verification code input is visible
        otp_input = page.locator("input[placeholder*='000000'], input[maxlength='6']").first
        if otp_input.is_visible():
            log("  âœ“ OTP verification code input visible (always shown)")
        else:
            log("  âœ-- OTP verification code input NOT visible", "ERROR")
        
        # Check send code button
        send_code_btn = page.locator("button:has(svg)").first  # mail icon button
        if send_code_btn.is_visible():
            log("  âœ“ Send code button found")
        
        # Check Create Account button is disabled initially (no OTP verified)
        create_btn = page.locator("button[type='submit']").first
        if create_btn.is_visible():
            is_disabled = create_btn.is_disabled()
            log(f"  Create Account button disabled: {is_disabled} (expected: True before OTP)")
        
        # Check Google OAuth button
        google_btn = page.locator("text=Continue with Google").first
        if google_btn.is_visible():
            log("  âœ“ Google OAuth button on register page")
        
        # ================================================================
        # 4. AUTH PAGES â€” RESET PASSWORD
        # ================================================================
        log("\n--- AUTH PAGES: RESET PASSWORD ---")
        test_route(page, "/reset-password", "Reset Password")
        
        # Without auth, should show the password form (not "Already Signed In")
        page.goto(f"{BASE}/reset-password", wait_until="networkidle")
        page.wait_for_timeout(1000)
        
        # Check for the password form OR the "Already Signed In" card
        already_signed = page.locator("text=Already Signed In").first
        password_form = page.locator("text=Set New Password").first
        
        if already_signed.is_visible():
            log("  âš  Shows 'Already Signed In' (user may have active session)")
        elif password_form.is_visible():
            log("  âœ“ Shows 'Set New Password' form (correct for unauthenticated)")
        else:
            # Check what's on the page
            content = page.locator("h1, h2, h3").all()
            headings = [h.inner_text() for h in content[:5]]
            log(f"  Page headings: {headings}")
        
        # ================================================================
        # 5. AUTH CALLBACK
        # ================================================================
        log("\n--- AUTH PAGES: CALLBACK ---")
        test_route(page, "/auth/callback", "Auth Callback")
        
        # ================================================================
        # 6. MOBILE RESPONSIVE (375x812)
        # ================================================================
        log("\n--- MOBILE RESPONSIVE (375x812) ---")
        test_mobile(browser, BASE)
        
        # ================================================================
        # 7. TEST LOGIN FLOW
        # ================================================================
        log("\n--- LOGIN FLOW TEST ---")
        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.wait_for_timeout(500)
        
        # Try to fill in test credentials
        email_el = page.locator("input[type='email'], input[name='email'], input[placeholder*='email' i]").first
        pass_el = page.locator("input[type='password'], input[name='password']").first
        
        if email_el.is_visible() and pass_el.is_visible():
            email_el.fill("admin@cougph.com")
            pass_el.fill("Admin123!")
            page.wait_for_timeout(300)
            
            submit = page.locator("button[type='submit']").first
            if submit.is_visible():
                log("  Filled login form, clicking submit...")
                submit.click()
                page.wait_for_timeout(3000)
                
                current_url = page.url
                log(f"  After login URL: {current_url}")
                
                if "/dashboard" in current_url:
                    log("  âœ“ Login successful â€” redirected to dashboard")
                elif "error" in page.content().lower():
                    errors = page.locator("[role='alert'], .text-red-600").all()
                    for e in errors:
                        log(f"  Login error: {e.inner_text()}", "WARN")
                else:
                    log(f"  Login result: {current_url}")
        
        # ================================================================
        # 8. TEST AUTHENTICATED PAGES (if logged in)
        # ================================================================
        log("\n--- AUTHENTICATED PAGES ---")
        current_url = page.url
        if "/dashboard" in current_url:
            test_route(page, "/dashboard", "Dashboard (authed)")
            test_route(page, "/dashboard/screening", "Screening (authed)")
            test_route(page, "/dashboard/screenings", "Screenings (authed)")
            test_route(page, "/dashboard/patients", "Patients (authed)")
            
            # Test navigation between pages
            page.goto(f"{BASE}/dashboard", wait_until="networkidle")
            page.wait_for_timeout(500)
            
            # Click on sidebar/nav links
            nav_items = page.locator("nav a, aside a, [role='navigation'] a").all()
            log(f"  Found {len(nav_items)} navigation items in dashboard")
            for item in nav_items[:8]:
                text = item.inner_text().strip()
                href = item.get_attribute("href")
                if text and href:
                    log(f"    Nav: '{text}' â†’ {href}")
            
            # Test screening button
            screening_btn = page.locator("text=New Screening, text=Start Screening, a[href*='screening']").first
            if screening_btn and screening_btn.is_visible():
                log("  âœ“ New Screening button found")
            
            # Test admin page (if admin)
            admin_link = page.locator("a[href*='admin']").first
            if admin_link and admin_link.is_visible():
                log("  âœ“ Admin link visible")
                admin_link.click()
                page.wait_for_timeout(2000)
                if "/admin" in page.url:
                    log("  âœ“ Admin page loaded")
                    # Check for user table
                    tables = page.locator("table").count()
                    log(f"    Tables on admin page: {tables}")
        else:
            log("  Not logged in â€” skipping authenticated pages")
        
        # ================================================================
        # 9. TEST 404 FALLBACK
        # ================================================================
        log("\n--- 404 FALLBACK ---")
        page.goto(f"{BASE}/nonexistent-page-12345", wait_until="networkidle")
        page.wait_for_timeout(1000)
        final_url = page.url
        log(f"  Unknown route redirects to: {final_url}")
        if "/" == final_url.replace(BASE, "") or final_url == BASE + "/":
            log("  âœ“ 404 correctly redirects to home")
        else:
            log("  âœ-- 404 redirect may not be working", "WARN")
        
        # ================================================================
        # SUMMARY
        # ================================================================
        log("\n" + "=" * 60)
        log("AUDIT SUMMARY")
        log("=" * 60)
        passed = sum(1 for r in RESULTS["routes"] if r.get("passed"))
        total = len(RESULTS["routes"])
        log(f"Routes tested: {total} | Passed: {passed} | Failed: {total - passed}")
        log(f"Console errors: {len(RESULTS['console_errors'])}")
        log(f"Network errors: {len(RESULTS['network_errors'])}")
        log(f"Broken buttons: {len(RESULTS['broken_buttons'])}")
        mobile_fails = sum(1 for m in RESULTS["mobile"] if m.get("overflow"))
        log(f"Mobile routes: {len([m for m in RESULTS['mobile'] if 'url' in m])} | Overflow failures: {mobile_fails}")
        
        if RESULTS["console_errors"]:
            log("\nConsole Errors:")
            for e in RESULTS["console_errors"][:20]:
                log(f"  {e}", "WARN")
        
        if RESULTS["network_errors"]:
            log("\nNetwork Errors:")
            for e in RESULTS["network_errors"][:20]:
                log(f"  {e}", "WARN")
        
        if RESULTS["broken_buttons"]:
            log("\nBroken Buttons:")
            for e in RESULTS["broken_buttons"]:
                log(f"  {e}", "ERROR")
        
        # Save full results
        with open("C:/Users/David/OneDrive/Documents/COUGHPH/audit_results.json", "w") as f:
            json.dump(RESULTS, f, indent=2)
        log("\nFull results saved to audit_results.json")
        
        browser.close()

if __name__ == "__main__":
    main()

