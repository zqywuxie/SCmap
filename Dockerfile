# Verified upstream image digest; override via --build-arg NGINX_IMAGE when upgrading.
ARG NGINX_IMAGE=nginx@sha256:90babf6ca20a03b57f1ecabb39163d95842e6c8e010cebca9eb4b6ffa277b955
FROM ${NGINX_IMAGE}
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
COPY src/ /usr/share/nginx/html/src/
COPY data/ /usr/share/nginx/html/data/
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD curl -fsS http://127.0.0.1/healthz || exit 1
