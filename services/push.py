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


def send(
    tokens: list[str],
    title: str,
    body: str,
    data: Optional[dict] = None,
    badge: Optional[int] = None,
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
            **({"badge": badge} if badge is not None else {}),
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
        except Exception as exc:
            logger.warning("[Push] Gönderim hatası: %s", exc)
