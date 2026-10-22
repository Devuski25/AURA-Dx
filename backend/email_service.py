"""Transactional email sending via Resend SMTP (standard library only).

Credentials are read from settings (populated by backend/.env.local):
  RESEND_API_KEY -> SMTP password
  SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_FROM

Every message the app sends is the same shape -- a plain-text part, an HTML part
in the same card, and the prototype disclaimer -- so the transport lives in one
place. Four copies of the same SMTP block used to sit in this file; adding a
fifth kind of email would have made a fifth copy, and only one of them would
have been fixed the next time Resend changed something.
"""
import smtplib
import ssl
from email.message import EmailMessage

from config import settings

SUPPORT_EMAIL = "supportauradx@gmail.com"


def _require_transport() -> str:
    """Return the From address, or raise the error that names the real cause.

    No fallback. This used to read `settings.smtp_from or "onboarding@resend.dev"`,
    which meant a blank SMTP_FROM silently became Resend's sandbox address --
    and that address can only ever deliver to the account owner's own inbox.
    The failure surfaced as a 550 from Resend about the recipient, which points
    at the wrong thing entirely. auradx.xyz is verified as a sending domain, so
    there is a real address to use and a missing one is a configuration bug.
    """
    if not (settings.smtp_host and settings.resend_api_key):
        raise RuntimeError("SMTP/Resend is not configured (check RESEND_API_KEY / SMTP_HOST)")

    from_addr = settings.smtp_from
    if not from_addr:
        raise RuntimeError(
            "SMTP_FROM is not set. Set it to a sender on the verified Resend "
            "domain (e.g. noreply@auradx.xyz)."
        )
    if "@" not in from_addr:
        raise RuntimeError(f"SMTP_FROM is not an email address: {from_addr!r}")
    return from_addr


def _deliver(
    to_email: str,
    subject: str,
    heading: str,
    text_body: str,
    html_body: str,
    *,
    disclaimer: bool = True,
) -> None:
    """Send one message: plain text, plus the branded HTML card.

    Raises on failure. Callers decide what a failure means -- an approval
    notice must not roll back the approval itself, while a password reset has
    to tell the person the truth rather than say "sent" and leave them waiting.
    """
    from_addr = _require_transport()

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_email
    msg.set_content(text_body)

    heading_html = f'<h3 style="margin:0 0 12px">{heading}</h3>' if heading else ""
    disclaimer_html = (
        '<p style="color:#6b7280;font-size:12px;margin-top:20px">'
        "AURA-Dx is a research prototype and does not provide a medical diagnosis."
        "</p>"
        if disclaimer
        else ""
    )
    msg.add_alternative(
        f"""<html><body style="font-family:Arial,sans-serif;color:#1f2937">
      <div style="max-width:420px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px">
        <h2 style="color:#3cb87a;margin:0 0 12px">AURA-Dx</h2>
        {heading_html}
        {html_body}
        {disclaimer_html}
      </div></body></html>""",
        subtype="html",
    )

    context = ssl.create_default_context()
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
        server.starttls(context=context)
        server.login(settings.smtp_user or "resend", settings.resend_api_key)
        server.send_message(msg)


def _first_name(full_name: str) -> str:
    return (full_name or "").strip().split(" ")[0] or "there"


def send_account_status_email(to_email: str, full_name: str, status: str) -> None:
    """Tell a clinician their account was approved or rejected.

    Exists because the Register page promises it. The confirmation dialog reads
    "You'll be notified once approved", and there was no code anywhere that sent
    anything -- an approval flipped a row in `profiles` and the person sat there
    waiting for an email that was never going to arrive.
    """
    first_name = _first_name(full_name)

    if status == "approved":
        _deliver(
            to_email,
            "Your AURA-Dx account has been approved",
            "Your account is approved",
            f"Hello {first_name},\n\n"
            "Your AURA-Dx clinician account has been approved. You can sign in and "
            "start screening.\n\n"
            f"If you have any questions, reply to {SUPPORT_EMAIL}.",
            "<p>Your AURA-Dx clinician account has been approved. You can "
            '<a href="https://auradx.xyz/login">sign in</a> and start screening.</p>'
            "<p>If you have any questions, email "
            f'<a href="mailto:{SUPPORT_EMAIL}">{SUPPORT_EMAIL}</a>.</p>',
        )
        return

    _deliver(
        to_email,
        "Update on your AURA-Dx account",
        "Your account was not approved",
        f"Hello {first_name},\n\n"
        "Thank you for registering for AURA-Dx. An administrator reviewed your "
        "account and was not able to approve it at this time.\n\n"
        "If you believe this is a mistake, or you would like to appeal, email "
        f"{SUPPORT_EMAIL}.",
        "<p>Thank you for registering for AURA-Dx. An administrator reviewed "
        "your account and was not able to approve it at this time.</p>"
        "<p>If you believe this is a mistake, or you would like to appeal, email "
        f'<a href="mailto:{SUPPORT_EMAIL}">{SUPPORT_EMAIL}</a>.</p>',
    )


def send_account_deleted_email(to_email: str, full_name: str) -> None:
    """Tell someone their account has been removed by an administrator.

    Sent after the account is actually gone, never before: an email that says
    "you have been removed" must not arrive while the account still works.

    It says the records went too, because they did -- deleting an account
    deletes the patients and screenings it created.
    """
    first_name = _first_name(full_name)

    _deliver(
        to_email,
        "Your AURA-Dx account has been removed",
        "Your account has been removed",
        f"Hello {first_name},\n\n"
        "An administrator has removed your AURA-Dx account, and it can no longer "
        "be used to sign in. Patient records that belonged to this account were "
        "deleted with it.\n\n"
        "If you believe this is a mistake, email "
        f"{SUPPORT_EMAIL}.",
        "<p>An administrator has removed your AURA-Dx account, and it can no "
        "longer be used to sign in. Patient records that belonged to this "
        "account were deleted with it.</p>"
        "<p>If you believe this is a mistake, email "
        f'<a href="mailto:{SUPPORT_EMAIL}">{SUPPORT_EMAIL}</a>.</p>',
    )


def send_password_reset_email(to_email: str, full_name: str, reset_url: str) -> None:
    """Send the password reset link.

    Supabase can make the link but cannot deliver it: this project's auth
    mailer answers every send with 500 "Error sending recovery email", which
    is what the Login page was reporting. Its own SMTP is either unconfigured
    or rejected, and that is a project setting this code cannot reach.

    So the link is generated by the service-role client (auth.admin.generate_link
    -- no mail involved) and delivered here, over the transport the verification
    code and the approval notice already use.

    Raises on failure, so the route can tell the user the truth instead of
    saying "sent" and leaving them waiting.
    """
    first_name = _first_name(full_name)

    _deliver(
        to_email,
        "Reset your AURA-Dx password",
        "Reset your password",
        f"Hello {first_name},\n\n"
        "Someone asked to reset the password for your AURA-Dx account. Use the "
        "link below to choose a new one:\n\n"
        f"{reset_url}\n\n"
        "The link can only be used once. If you did not ask for this, you can "
        "ignore this email -- your password has not been changed.\n\n"
        f"If you need help, reply to {SUPPORT_EMAIL}.",
        f"<p>Hello {first_name},</p>"
        "<p>Someone asked to reset the password for your AURA-Dx account. Choose a "
        "new one here:</p>"
        '<p style="margin:20px 0">'
        f'<a href="{reset_url}" '
        'style="background:#0E7A55;color:#ffffff;padding:12px 20px;border-radius:8px;'
        'text-decoration:none;font-weight:600">Choose a new password</a>'
        "</p>"
        '<p style="color:#6b7280;font-size:13px">The link can only be used once. If you '
        "did not ask for this, you can ignore this email &mdash; your password has not "
        "been changed.</p>",
    )


def send_verification_email(to_email: str, code: str) -> None:
    _deliver(
        to_email,
        "Your AURA-Dx email verification code",
        "",
        f"Your AURA-Dx email verification code is: {code}\n\n"
        "Enter this code on the registration page to verify your email address.\n"
        "This code expires in 10 minutes. If you did not request this, you can ignore this email.",
        "<p>Your email verification code is:</p>"
        '<div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#111827;margin:12px 0">'
        f"{code}</div>"
        '<p style="color:#6b7280;font-size:13px">This code expires in 10 minutes. '
        "If you did not request this, you can ignore this email.</p>",
        disclaimer=False,
    )
