"""Transactional email sending via Resend SMTP (standard library only).

Credentials are read from settings (populated by backend/.env.local):
  RESEND_API_KEY -> SMTP password
  SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_FROM
"""
import smtplib
import ssl
from email.message import EmailMessage

from config import settings


def send_verification_email(to_email: str, code: str) -> None:
    if not (settings.smtp_host and settings.resend_api_key):
        raise RuntimeError("SMTP/Resend is not configured (check RESEND_API_KEY / SMTP_HOST)")

    from_addr = settings.smtp_from or "onboarding@resend.dev"
    msg = EmailMessage()
    msg["Subject"] = "Your AURA-Dx email verification code"
    msg["From"] = from_addr
    msg["To"] = to_email

    msg.set_content(
        f"Your AURA-Dx email verification code is: {code}\n\n"
        "Enter this code on the registration page to verify your email address.\n"
        "This code expires in 10 minutes. If you did not request this, you can ignore this email."
    )

    html = f"""<html><body style="font-family:Arial,sans-serif;color:#1f2937">
      <div style="max-width:420px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px">
        <h2 style="color:#3cb87a;margin:0 0 12px">AURA-Dx</h2>
        <p>Your email verification code is:</p>
        <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#111827;margin:12px 0">{code}</div>
        <p style="color:#6b7280;font-size:13px">This code expires in 10 minutes. If you did not request this, you can ignore this email.</p>
      </div></body></html>"""
    msg.add_alternative(html, subtype="html")

    context = ssl.create_default_context()
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
        server.starttls(context=context)
        server.login(settings.smtp_user or "resend", settings.resend_api_key)
        server.send_message(msg)
