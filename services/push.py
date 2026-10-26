"""Push bildirimleri — Expo Push API (ücretsiz, credential gerektirmez).

Expo, ExponentPushToken[...] formatındaki token'ları FCM/APNs'e yönlendirir.
Dokümantasyon: https://docs.expo.dev/push-notifications/sending-notifications/
"""
import logging
from typing import Optional

import requests

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
EXPO_PUSH_RECEIPT_URL = "https://exp.host/--/api/v2/push/getReceipts"

# Uygulamanın açılışta oluşturduğu Android bildirim kanalı.
# mobile/src/api/notifications.js içindeki ANDROID_CHANNEL_ID ile aynı olmalı.
ANDROID_CHANNEL_ID = "default"


def send(
    tokens: list[str],
    title: str,
    body: str,
    data: Optional[dict] = None,
    badge: Optional[int] = None,
    category_id: Optional[str] = None,
) -> None:
    """Bir veya birden fazla Expo push token'ına bildirim gönderir.

    Geçersiz/boş token listesi sessizce atlanır.
    Expo maksimum 100 mesaj/istek kabul eder — otomatik batch yapılır.
    """
    valid = [t for t in tokens if t and t.startswith("ExponentPushToken[")]
    if not valid:
        return

    messages = [
        {
            "to": token,
            "title": title,
            "body": body,
            "data": data or {},
            "sound": "default",
            # Android'de kanal belirtilmezse Expo'nun yedek kanalına düşer ve
            # uygulamada kurduğumuz kanal (önem/titreşim/ışık) kullanılmaz.
            # Karşılığı: mobile/src/api/notifications.js → ANDROID_CHANNEL_ID
            "channelId": ANDROID_CHANNEL_ID,
            **({"badge": badge} if badge is not None else {}),
            **({"categoryId": category_id} if category_id else {}),
        }
        for token in valid
    ]

    for i in range(0, len(messages), 100):
        batch = messages[i : i + 100]
        try:
            resp = requests.post(
                EXPO_PUSH_URL,
                json=batch,
                headers={"Content-Type": "application/json", "Accept": "application/json"},
                timeout=10,
            )
            resp.raise_for_status()
            logger.info("[Push] %d bildirim gönderildi.", len(batch))
            _drop_dead_tokens(resp.json(), [m["to"] for m in batch])
        except Exception as exc:
            logger.warning("[Push] Gönderim hatası: %s", exc)


def _drop_dead_tokens(payload: dict, sent_to: list[str]) -> None:
    """Expo 'DeviceNotRegistered' dönen token'ları siler.

    Uygulama kaldırıldığında veya token yenilendiğinde eskisi ölür; temizlenmezse
    her turda boşuna gönderim denenir ve tablo çöple dolar.
    """
    try:
        results = (payload or {}).get("data") or []
        dead = [
            sent_to[i]
            for i, item in enumerate(results)
            if i < len(sent_to)
            and isinstance(item, dict)
            and item.get("status") == "error"
            and (item.get("details") or {}).get("error") == "DeviceNotRegistered"
        ]
        if not dead:
            return

        from database import SessionLocal
        import models
        db = SessionLocal()
        try:
            removed = db.query(models.PushToken).filter(
                models.PushToken.token.in_(dead)
            ).delete(synchronize_session=False)
            db.commit()
            logger.info("[Push] %d geçersiz token silindi.", removed)
        finally:
            db.close()
    except Exception as exc:
        logger.warning("[Push] Ölü token temizliği başarısız: %s", exc)
