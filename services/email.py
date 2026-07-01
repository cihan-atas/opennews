"""E-posta gönderimi — sağlayıcı-bağımsız, ücretsiz-öncelikli.

SMTP yapılandırılmışsa (settings.SMTP_HOST dolu) gerçek e-posta gönderir.
Yapılandırılmamışsa (dev modu) e-postayı server log'una yazar — böylece şifre
sıfırlama akışı SMTP olmadan da test edilebilir.
"""
import smtplib
from email.mime.text import MIMEText
from email.utils import formataddr

from services.settings_store import settings  # DB→.env çözümlemeli proxy


def _smtp_configured() -> bool:
    return bool(settings.SMTP_HOST and settings.SMTP_USER and settings.SMTP_PASSWORD)


def send_email(to: str, subject: str, body: str) -> bool:
    """Düz metin e-posta gönderir. Başarı durumunda True döner.

    SMTP yoksa içeriği log'a yazıp True döner (akışı bozmaz)."""
    if not _smtp_configured():
        print(
            f"\n[EMAIL — DEV MODU] SMTP yapılandırılmadı, e-posta gönderilmedi.\n"
            f"  Alıcı : {to}\n"
            f"  Konu  : {subject}\n"
            f"  İçerik:\n{body}\n"
        )
        return True

    sender = settings.SMTP_FROM or settings.SMTP_USER
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = formataddr(("Haber & Podcast", sender))
    msg["To"] = to

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as server:
            if settings.SMTP_USE_TLS:
                server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(sender, [to], msg.as_string())
        return True
    except Exception as err:
        print(f"[EMAIL] Gönderim başarısız ({to}): {err}")
        return False


def send_password_reset(to: str, reset_link: str) -> bool:
    """Şifre sıfırlama linkini içeren e-postayı gönderir."""
    subject = "Şifre Sıfırlama İsteği"
    body = (
        "Merhaba,\n\n"
        "Hesabınız için bir şifre sıfırlama isteği aldık. Yeni şifrenizi belirlemek "
        "için aşağıdaki bağlantıya tıklayın (1 saat geçerlidir):\n\n"
        f"{reset_link}\n\n"
        "Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz; şifreniz "
        "değişmeden kalır.\n"
    )
    return send_email(to, subject, body)
