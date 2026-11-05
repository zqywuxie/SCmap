# Verified upstream image digest; override via --build-arg NGINX_IMAGE when upgrading.
ARG NGINX_IMAGE=nginx@sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949
FROM ${NGINX_IMAGE}
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
COPY src/ /usr/share/nginx/html/src/
COPY data/ /usr/share/nginx/html/data/
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -q -O - http://127.0.0.1/healthz || exit 1
