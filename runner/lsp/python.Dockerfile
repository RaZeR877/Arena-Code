FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN pip install --no-cache-dir python-lsp-server
WORKDIR /workspace
USER 1000:1000
CMD ["pylsp", "--stdio"]
