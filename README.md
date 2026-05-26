# AI-Powered News Bulletin & Podcast

![FastAPI](https://img.shields.io/badge/FastAPI-0.124-009688?style=flat&logo=fastapi)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+pgvector-336791?style=flat&logo=postgresql)
![Celery](https://img.shields.io/badge/Celery-5.3-37814A?style=flat&logo=celery)
![Redis](https://img.shields.io/badge/Redis-alpine-DC382D?style=flat&logo=redis)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat&logo=docker)
![GCP](https://img.shields.io/badge/GCP-Vertex_AI_+_TTS_+_GCS-4285F4?style=flat&logo=googlecloud)
![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=flat&logo=python)

A **12-factor, cloud-native** application that scrapes real-time Turkish news from 15 RSS sources, summarizes each article using **Gemini 2.5 Flash**, generates personalized audio podcasts via **Google Text-to-Speech**, and serves everything through a responsive React frontend — all running as isolated Docker services on GCP.

> **Live Demo:** [https://news-and-podcast-frontend-861840374112.europe-west3.run.app/auth](https://news-and-podcast-frontend-861840374112.europe-west3.run.app/auth)

---

## Table of Contents

1. [Features](#features)
2. [Architecture](#architecture)
3. [Tech Stack](#tech-stack)
4. [Prerequisites](#prerequisites)
5. [Quick Start](#quick-start)
6. [Environment Variables](#environment-variables)
7. [Project Structure](#project-structure)
8. [API Reference](#api-reference)
9. [AI Pipeline](#ai-pipeline)
10. [Database Schema](#database-schema)
11. [Development Workflow](#development-workflow)

---

## Features

| Feature | Description |
|---|---|
| **Real-time News Feed** | 15 Turkish RSS sources across 15 categories, scraped automatically on startup and on-demand |
| **AI Summarization** | Gemini 2.5 Flash generates 8–12 sentence Turkish summaries optimized for audio narration |
| **Podcast Generation** | Google TTS converts AI summaries to MP3, stored in GCS Frankfurt, streamed via signed URLs |
| **Semantic Search** | pgvector + `text-embedding-005` (768-dim) — cosine distance search across all articles |
| **Related Articles** | Per-article "you might also like" powered by embedding similarity |
| **Trending News** | Top stories from the last 24 hours ranked by click activity |
| **Bookmark System** | Save and manage articles across sessions |
| **Personal RSS Reader** | Add custom RSS feeds, organize into lists, generate podcasts from any article |
| **Community RSS Sources** | Users can submit new RSS feeds; admins approve/reject |
| **AI Feedback** | Thumbs up/down on every AI-generated summary — feeds future improvement |
| **Smart Category Suggestions** | After 5 clicks in a category, the app suggests adding it to your interests |
| **Responsive UI** | Mobile-first layout with collapsible sidebar, floating audio player, Web Share API |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Docker Compose                           │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │   frontend   │    │     api      │    │  scraper-worker  │  │
│  │  React:5173  │───▶│ FastAPI:8080 │    │  Celery Q:scraper│  │
│  └──────────────┘    └──────┬───────┘    └────────┬─────────┘  │
│                             │                     │            │
│                      ┌──────▼───────┐    ┌────────▼─────────┐  │
│                      │     db       │    │    ai-worker     │  │
│                      │  PostgreSQL  │◀───│  Celery Q:ai (4x)│  │
│                      │  + pgvector  │    └────────┬─────────┘  │
│                      └──────────────┘             │            │
│                             ▲            Gemini Flash           │
│                      ┌──────┴───────┐    Google TTS            │
│                      │    redis     │    GCS Frankfurt          │
│                      │   :6379      │             │            │
│                      └──────────────┘             ▼            │
│                                           GCS (audio_url)      │
└─────────────────────────────────────────────────────────────────┘
```

**Async Task Flow:**

```
App Startup / POST /news/refresh
        │
        ▼
run_scraper_task  ──────────────────────────────▶  scraper_queue
  (concurrency=1)                                       │
                                                        ▼
                                               RSS parse + scrape
                                               BeautifulSoup extract
                                               DB insert (checkpoint)
                                                        │
                                                        ▼
                                       auto_generate_summaries_task ──▶ ai_queue
                                                        │
                                              ┌─────────┴──────────┐
                                              ▼                    ▼
                                        Gemini Flash         text-embedding-005
                                        (summary)            (768-dim vector)
                                              │                    │
                                              └─────────┬──────────┘
                                                        ▼
                                                  DB commit

User requests podcast:
        │
        ▼
process_news_and_tts_task  ──▶  ai_queue
        │
        ├─▶ Gemini Flash (summary)
        ├─▶ Google TTS (MP3)
        ├─▶ GCS upload
        └─▶ Podcast row in DB
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **API** | FastAPI 0.124, Uvicorn, Pydantic v2, SQLAlchemy 2.0 |
| **Auth** | JWT (python-jose), bcrypt (passlib), HttpOnly refresh tokens |
| **Database** | PostgreSQL 16, pgvector extension, Alembic (18 migrations) |
| **Task Queue** | Celery 5.3, Redis (message broker) |
| **AI — Summarization** | Gemini 2.5 Flash via Vertex AI (`google-genai`) |
| **AI — Embeddings** | `text-embedding-005`, 768 dimensions, cosine distance |
| **AI — Audio** | Google Cloud Text-to-Speech (`tr-TR`, NEUTRAL) |
| **Storage** | Google Cloud Storage, Frankfurt (`europe-west3`) |
| **Frontend** | React 19, React Router 7, Vite 8 |
| **Infrastructure** | Docker, Docker Compose, GCP (Cloud Run ready) |

---

## Prerequisites

Before you begin, make sure you have:

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose installed
- A **Google Cloud Platform** project with these APIs enabled:
  - Vertex AI API
  - Cloud Text-to-Speech API
  - Cloud Storage API
- A **GCP service account** JSON key with roles: `Vertex AI User`, `Storage Object Admin`
- A **GCS bucket** in `europe-west3` (Frankfurt)

---

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/UtkuAkkusoglu/AI-Powered-News-Bulletin-and-Podcast.git
cd AI-Powered-News-Bulletin-and-Podcast
```

### 2. Add your GCP credentials

Place your service account JSON file in the project root:

```bash
cp /path/to/your-service-account.json ./gcp-service-account.json
```

### 3. Configure environment variables

```bash
cp .env.example .env
# Edit .env with your values (see Environment Variables section)
```

### 4. Start all services

**Option A — Local mode** (uses a local PostgreSQL container, no cloud DB needed):

```bash
docker-compose -f docker-compose-dev.yml up --build
```

**Option B — Cloud mode** (connects to Cloud SQL):

```bash
# First, authorize your IP in GCP Console:
# Cloud SQL → your-instance → Connections → Networking → Authorized networks

docker-compose up --build
```

### 5. Run database migrations

```bash
docker-compose exec api alembic upgrade head
```

### 6. Open the app

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| API (Swagger UI) | http://localhost:8080/docs |
| API (ReDoc) | http://localhost:8080/redoc |

On first startup the scraper runs automatically in the background — news will begin appearing within a few minutes.

---

## Environment Variables

Create a `.env` file in the project root using this template:

```env
# ── Database ──────────────────────────────────────────────────────
DATABASE_URL=postgresql://postgres:yourpassword@db:5432/news_and_podcast
POSTGRES_USER=postgres
POSTGRES_PASSWORD=yourpassword
POSTGRES_DB=news_and_podcast

# ── Security ──────────────────────────────────────────────────────
SECRET_KEY=your-very-long-random-secret-key-here
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
REFRESH_TOKEN_EXPIRE_DAYS=7

# ── Google Cloud ──────────────────────────────────────────────────
GOOGLE_APPLICATION_CREDENTIALS=gcp-service-account.json
GCP_PROJECT_ID=your-gcp-project-id
GCP_BUCKET_NAME=your-gcs-bucket-name
GCP_LOCATION=europe-west3

# ── Celery / Redis ────────────────────────────────────────────────
CELERY_BROKER_URL=redis://redis:6379/0

# ── Frontend ──────────────────────────────────────────────────────
FRONTEND_URL=http://localhost:5173
VITE_API_URL=http://localhost:8080
```

---

## Project Structure

```
AI-Powered-News-Bulletin-and-Podcast/
│
├── main.py                  # FastAPI app, CORS, startup event
├── models.py                # SQLAlchemy ORM models (11 tables)
├── schemas.py               # Pydantic request/response schemas
├── config.py                # Pydantic settings (reads .env)
├── database.py              # DB engine + session factory
├── dependencies.py          # Shared FastAPI dependencies (db, auth)
├── utils.py                 # JWT helpers, GCS upload/delete, embeddings
├── worker.py                # Celery app + all async tasks
├── scraper.py               # RSS scraper (feedparser + BeautifulSoup)
├── seed_data.py             # Seeds the 15 news categories on startup
│
├── routers/
│   ├── auth.py              # Register, login, refresh, logout
│   ├── news.py              # Feed, search, click tracking, trending
│   ├── podcast.py           # List, create, delete podcasts
│   ├── users.py             # Profile, interests
│   ├── categories.py        # Category list
│   ├── bookmarks.py         # Save/remove articles
│   ├── feed.py              # RSS XML output (/feed.xml)
│   ├── rss.py               # Community RSS source submission
│   └── rss_reader.py        # Personal RSS lists + article podcasts
│
├── alembic/                 # Database migrations (18 versions)
│   └── versions/
│
├── frontend/
│   └── src/
│       ├── App.jsx          # Router, layout, global player
│       ├── components/
│       │   ├── Home.jsx         # News feed (689 lines)
│       │   ├── Podcast.jsx      # Podcast library
│       │   ├── RssReader.jsx    # Personal RSS reader (709 lines)
│       │   ├── Bookmarks.jsx    # Saved articles
│       │   ├── Settings.jsx     # Profile, interests, RSS submit
│       │   ├── Sidebar.jsx      # Navigation (collapsible)
│       │   ├── AudioPlayer.jsx  # Floating player
│       │   ├── Auth.jsx         # Login / Register
│       │   └── Onboarding.jsx   # First-run category selection
│       └── contexts/
│           └── PlayerContext.jsx # Global audio player state
│
├── docker-compose.yml       # Production / Cloud SQL mode (6 services)
├── docker-compose-dev.yml   # Local mode (local PostgreSQL container)
├── Dockerfile               # Python 3.11-slim, non-root appuser
└── requirements.txt         # Python dependencies
```

---

## API Reference

Full interactive documentation is available at **http://localhost:8080/docs** (Swagger UI).

### Authentication (`/auth`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/register` | Create a new account |
| `POST` | `/auth/login` | Login, receive access + refresh tokens |
| `POST` | `/auth/refresh` | Rotate refresh token, get new access token |
| `POST` | `/auth/logout` | Invalidate refresh token |

### News (`/news`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/news/` | Paginated feed; supports `search`, `category_id`, `interests_only` |
| `GET` | `/news/trending` | Top 10 articles from the last 24 hours |
| `GET` | `/news/{id}` | Full article detail |
| `GET` | `/news/{id}/related` | 5 semantically similar articles (pgvector) |
| `GET` | `/news/{id}/translate` | Translate summary to English or Turkish (Gemini) |
| `POST` | `/news/` | Add a new article (triggers AI pipeline) |
| `POST` | `/news/refresh` | Trigger the RSS scraper |
| `GET` | `/news/refresh/status` | Check if scraper is running (`idle`/`processing`) |
| `POST` | `/news/{id}/click` | Track a click; returns category suggestion after 5 clicks |
| `POST` | `/news/{id}/feedback` | Submit `up`/`down` rating on AI summary |
| `GET` | `/news/{id}/feedback/mine` | Get the current user's rating for an article |

### Podcasts (`/podcast`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/podcast/` | Paginated list of the user's podcasts |
| `GET` | `/podcast/{id}` | Podcast detail with a 60-minute signed GCS audio URL |
| `POST` | `/podcast/{news_id}/generate` | Generate podcast from a news article (queues Celery task) |
| `DELETE` | `/podcast/{id}` | Delete podcast and remove the MP3 from GCS |

### Users (`/users`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/users/me` | Current user profile + interests |
| `POST` | `/users/interests` | Update interest categories (minimum 2 required) |

### Bookmarks (`/bookmarks`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/bookmarks/` | Paginated saved articles |
| `POST` | `/bookmarks/{news_id}` | Save an article |
| `DELETE` | `/bookmarks/{news_id}` | Remove a saved article |

### RSS Reader (`/rss-reader`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/rss-reader/lists` | All personal RSS lists |
| `POST` | `/rss-reader/lists` | Create a new list |
| `DELETE` | `/rss-reader/lists/{id}` | Delete a list and its feeds |
| `POST` | `/rss-reader/lists/{id}/feeds` | Add a feed URL to a list |
| `DELETE` | `/rss-reader/feeds/{id}` | Remove a feed |
| `GET` | `/rss-reader/lists/{id}/articles` | Fetch and parse articles from a list's feeds |
| `POST` | `/rss-reader/podcast` | Generate podcast from any RSS article text |
| `POST` | `/rss-reader/translate` | Translate RSS article text with Gemini |

### Other

| Method | Path | Description |
|---|---|---|
| `GET` | `/categories/` | All 15 news categories |
| `GET` | `/feed.xml` | Standard RSS XML output (supports `category_id` filter) |
| `POST` | `/rss/submit` | Submit a community RSS source for review |

---

## AI Pipeline

### Scrape → Summarize → Embed → Speak

```
1. SCRAPE
   feedparser parses 15 RSS feeds
   BeautifulSoup extracts article body (CSS selector cascade)
   Deduplication via source_url UNIQUE constraint + .scraper_seen_urls.json
   Checkpoint commit after each article (no data loss on crash)

2. SUMMARIZE  (auto_generate_summaries_and_embeddings_task)
   Gemini 2.5 Flash via Vertex AI
   Prompt: "8–12 sentence Turkish podcast narration, no bullet points"
   Stored in News.summary

3. EMBED  (same task, same loop)
   Vertex AI text-embedding-005
   Input: title + "\n\n" + content
   768-dimension vector → News.embedding (pgvector Vector type)
   Used for: semantic search + related articles (cosine distance)

4. TEXT-TO-SPEECH  (process_news_and_tts_task — user triggered)
   Google Cloud TTS, language: tr-TR, gender: NEUTRAL
   Output: MP3, ~150 words/min duration estimate
   Upload to GCS bucket (europe-west3)
   Signed URL generated on GET (60-minute expiry, V4 signature)
```

### Worker Queues

| Queue | Worker | Concurrency | Jobs |
|---|---|---|---|
| `scraper_queue` | `scraper-worker` | 1 | RSS scraping (sequential to avoid URL race conditions) |
| `ai_queue` | `ai-worker` | 4 | Summarization, embedding, TTS, RSS podcast generation |

---

## Database Schema

```
users ─────────────────── user_interests (M2M) ─── categories
  │                                                      │
  ├── podcasts                                      news ─┘
  ├── user_clicks                                    │
  ├── user_bookmarks ──────────────────────────────▶ │
  ├── summary_feedback ───────────────────────────▶  │
  ├── user_rss_lists
  │      └── user_rss_feeds
  └── community_rss_sources

refresh_tokens (user_id FK, CASCADE delete)
```

**Key design decisions:**
- `News.source_url` is `UNIQUE` — prevents duplicate scraping at the DB level
- `News.embedding` is `Vector(768)` — requires pgvector extension (auto-created on startup)
- `Podcast.audio_url` stores the public GCS path; signed URLs are generated per-request, not stored
- All timestamps use `timezone=True` — consistent UTC across all tables

---

## Development Workflow

### Running Alembic migrations

After modifying `models.py`:

```bash
# Generate migration file
docker-compose exec api alembic revision --autogenerate -m "describe_your_change"

# Apply to database
docker-compose exec api alembic upgrade head
```

### Manually triggering the scraper

```bash
# Inside the running API container
docker-compose exec api python scraper.py

# With a limit (useful for testing)
docker-compose exec api python scraper.py --limit 20
```

### Monitoring Celery tasks

```bash
# Scraper worker logs
docker-compose logs -f scraper-worker

# AI worker logs
docker-compose logs -f ai-worker
```

### Rebuilding after dependency changes

```bash
docker-compose up --build
```

### News categories

The 15 supported categories are seeded automatically on startup:

```
Teknoloji, Ekonomi, Spor, Siyaset, Sağlık,
Kültür-Sanat, Bilim, Otomobil, Oyun, Magazin,
Eğitim, Dünya, Türkiye, Gastronomi, Diğer
```

---

## Security Notes

- `gcp-service-account.json` must **never** be committed to version control — add it to `.gitignore`
- The `appuser` in the Docker container has no system-level privileges (non-root)
- Refresh tokens are stored hashed in the database and rotated on every use
- Audio files are served via time-limited signed URLs (not public GCS links)
- CORS origins are controlled via the `FRONTEND_URL` environment variable
