# Deployment validation · 2026-11-05

- Python checksum validation: all 8 CD4/CD8 browser arrays passed.
- Node statistics tests: 5 passed.
- Linux Bash syntax and `deploy.sh --check`: passed.
- Docker build, Nginx configuration check, isolated candidate health/manifest requests and final container start: passed.
- Full GitHub fetch → fast-forward → execute updated script → deploy: passed against origin/main.
- Simulated occupied target port: replacement failed as expected, previous container automatically restored and its original endpoint returned HTTP 200.
- Nginx serves compressed arrays as application/octet-stream without Content-Encoding, preserving client gzip decoding and checksum validation.
- Test containers used loopback-only ports 18765/18766 and unique names; no existing production service was changed.

The application uses the frontend's existing verified source/arrays. Earlier UI validation covered 20 real ranking scenarios, both sorts and 10,038 result rows.
