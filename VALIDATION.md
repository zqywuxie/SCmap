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

# TABLO integration · 2026-11-20

- Registered Pan-disease and TABLO as separate manifests in data/datasets.json. The deployment validator checks all 16 array hashes and dimensions across both datasets.
- Exported all 3,187,038 CD4 and 902,119 conventional CD8 verified TABLO pairs, without sampling, expression loading or UMAP refitting. Author float64 coordinates were converted to float32; maximum absolute error 3.4881e-7.
- Independently compared every exported cell's source row/ID, coordinates, author L3 annotation, canonical donor, tissue and V/J against the corrected H5AD and validated pair tables. Upstream preparation and independent CSV verification covered all 20 samples. Source size/mtime signatures stayed unchanged.
- Generated 24 single-gene/pair cases over CD4/CD8 and all/Blood/Tonsil, including TRAV1-2, TRBV20-1, TRAV1-2 + TRAJ33 and TRBV20-1 + TRBJ2-4.
- Playwright checked those 24 browser cases against the independent references: cohort/valid/carrier counts, per-subtype counts, unique donors, maximum donor contribution and rendered highlights all matched. Six subtype-to-pair ranking cases checked both denominators, donor support, sorting and selection from the ranking table.
- Switching back to Pan-disease restored its CD4/CD8 counts, study filtering and dictionaries, cleared prior selections, and hid TABLO-only tissue controls. Desktop and 390px mobile layouts were inspected; no page overflow, page errors or failed resource requests occurred.
- Existing seven statistics tests passed; Python/JavaScript syntax checks, deployment Bash syntax and both-dataset asset validation passed. Preview uses http://127.0.0.1:8765/; deployment port remains 10323.
- Full export/audit artifacts are at data/TABLO_Sureshchandra_2025/analysis/scmap on ssh local. Browser-only assets are under data/TABLO in this repository. No CDR3, expression matrices or full cell ID maps are shipped.
