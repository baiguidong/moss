ARG PYTHON_BASE_IMAGE=python:3.12-slim-bookworm
FROM ${PYTHON_BASE_IMAGE}

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir --requirement requirements.txt \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin ragflow-mcp

COPY server.py ./

USER 10001:10001
EXPOSE 9385
HEALTHCHECK --interval=15s --timeout=5s --retries=12 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:9385/healthz', timeout=3)"]

CMD ["python", "/app/server.py"]
