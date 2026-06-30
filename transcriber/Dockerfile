# Whisper sidecar — Python is unavoidable (faster-whisper is Python-only), and
# mounting the shared `whisper-cache` volume at HF_HOME reuses the model the
# other tools on this machine already downloaded.
# Runs as root on purpose: the cache files in the shared volume are owned by
# another container's user (uid 10000).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/opt/whisper-cache

# ffmpeg → broad audio decoding (webm/opus, m4a, mp3, ogg, wav)
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

# requests: imported by faster-whisper 1.1.1 but not declared by it (newer
# huggingface_hub no longer pulls it in transitively).
RUN pip install \
      "faster-whisper==1.1.1" \
      "fastapi==0.115.6" \
      "uvicorn[standard]==0.34.0" \
      "python-multipart==0.0.20" \
      "requests==2.32.3"

WORKDIR /app
COPY server.py /app/server.py

EXPOSE 8080
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
