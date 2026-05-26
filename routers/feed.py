from fastapi import APIRouter
from fastapi.responses import Response
from database import SessionLocal
import models
from xml.etree.ElementTree import Element, SubElement, tostring
from xml.dom.minidom import parseString
from datetime import timezone

router = APIRouter(tags=["Feed"])


def _rfc2822(dt) -> str:
    if dt is None:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.strftime("%a, %d %b %Y %H:%M:%S +0000")


@router.get("/feed.xml", response_class=Response)
def rss_feed(category_id: int = None, limit: int = 50):
    db = SessionLocal()
    try:
        query = db.query(models.News)
        if category_id:
            query = query.filter(models.News.category_id == category_id)
        news_items = (
            query.order_by(models.News.published_at.desc().nullslast(), models.News.created_at.desc())
            .limit(limit)
            .all()
        )

        rss = Element("rss", version="2.0")
        rss.set("xmlns:atom", "http://www.w3.org/2005/Atom")
        channel = SubElement(rss, "channel")

        SubElement(channel, "title").text = "NewsFlow"
        SubElement(channel, "description").text = "AI destekli kişisel haber akışı"
        SubElement(channel, "language").text = "tr"

        for n in news_items:
            item = SubElement(channel, "item")
            SubElement(item, "title").text = n.title
            SubElement(item, "link").text = n.source_url or ""
            SubElement(item, "guid").text = n.source_url or str(n.id)
            SubElement(item, "description").text = n.summary or ""
            SubElement(item, "pubDate").text = _rfc2822(n.published_at or n.created_at)
            if n.category:
                SubElement(item, "category").text = n.category.name

        xml_bytes = tostring(rss, encoding="unicode")
        pretty = parseString(xml_bytes).toprettyxml(indent="  ")
        return Response(content=pretty, media_type="application/rss+xml; charset=utf-8")
    finally:
        db.close()
