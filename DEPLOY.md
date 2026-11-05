# Linux 部署与更新

## 架构与依赖

GitHub main → deploy.sh 拉取 → 校验 8 个浏览器数组 → Docker 构建 → 临时端口验证 Nginx 和 manifest → 替换正式容器 → 健康检查。失败时恢复上一容器。切换有数秒中断，Docker 重启后容器自动恢复。旧容器保留为 `scmap-previous`，旧镜像不会自动删除。

需要 Bash、Git、curl、Python ≥3.9、util-linux 的 flock，以及可使用的 Docker Engine。无 GPU、Node、npm 或 Python 第三方包要求；浏览器在客户端用 WebGL 绘图。建议预留 1 GB 可用内存和 2 GB 磁盘用于镜像及历史版本。

先由服务器管理员安装 Docker Engine 并配置当前用户权限。脚本不会更改系统软件、SSH 配置、防火墙或已有反向代理。仓库 SSH 地址需要该 Linux 用户的 GitHub 密钥有读取权限，推荐使用仓库只读 deploy key。

## 首次部署

```bash
git clone git@github.com:zqywuxie/SCmap.git
cd SCmap
bash deploy.sh --check  # 检查依赖与数据，不修改容器
bash deploy.sh
```

默认监听 `0.0.0.0:10323`。在服务器防火墙／云安全组中放行需要的端口，再访问 `http://服务器IP:10323/`。网页用绝对 `/data/` 路径，须部署在域名根路径 `/`。

如服务器上仅有一份 deploy.sh，也可执行：脚本会在指定路径不存在时自动克隆仓库。

```bash
SCMAP_DIR="$HOME/SCmap" bash deploy.sh
```

## 后续更新

```bash
cd ~/SCmap
bash deploy.sh
```

自动 fetch 并 fast-forward 到 origin/main，执行更新后的部署脚本。工作区有本地修改、分支不符或历史分叉时停止，不强制覆盖。不要在服务器改动源码。部署持有文件锁，避免同一 checkout 并发部署。

配置通过环境变量传入，每次部署需使用相同端口／名称；可在仓库外的运维脚本中统一设置：

| 变量 | 默认值 | 用途 |
|---|---|---|
| SCMAP_DIR | 当前脚本仓库；独立脚本时 ~/scmap | checkout 路径 |
| REPO_URL | git@github.com:zqywuxie/SCmap.git | 拉取地址，须与 origin 一致 |
| BRANCH | main | 拉取分支 |
| APP_NAME | scmap | 容器名，避免与其他应用重名 |
| PORT | 10323 | 主机 HTTP 端口 |
| BIND_ADDRESS | 0.0.0.0 | IPv4 监听地址 |
| NGINX_IMAGE | Dockerfile 中的已验证 digest | 升级基础镜像或使用内部镜像 |

示例：`BIND_ADDRESS=127.0.0.1 PORT=8765 bash deploy.sh`。`.env` 不自动加载，避免执行意外的 shell 配置。

## 公网 HTTPS

建议容器仅监听 `127.0.0.1:10323`，由已有 Nginx／Caddy 或云负载均衡终结 TLS。域名和证书确定后，将域名根路径代理到容器；以下放入已有 HTTPS server 块：

```nginx
location / {
    proxy_pass http://127.0.0.1:10323;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

客户端应使用现代浏览器。数据文件已 gzip 压缩，Nginx 必须按原始字节发送 `.gz`，不要额外设置 `Content-Encoding: gzip`，因为页面自行解压并校验。当前数据含来源与样本分类代码，网站本身无登录功能；需要限制访问时在反向代理层配置认证。

## 验证与排障

```bash
curl -f http://127.0.0.1:10323/healthz
curl -f http://127.0.0.1:10323/data/manifest.json
docker ps --filter name=scmap
docker logs --tail 100 scmap
```

页面检查 CD4/CD8、单基因／组合、两种排名方向以及研究筛选。数组缺失／损坏会在切换前被阻止。端口占用时新容器启动失败，脚本自动恢复上一容器。

自动回退只保证容器恢复；checkout 仍是新版本，便于修复后再次部署。人工回退（先确认 previous 是需要的旧版本）：

```bash
docker stop scmap
docker rename scmap scmap-failed
docker rename scmap-previous scmap
docker start scmap
```

容器具有 `org.scmap.app` 标签。脚本拒绝覆盖同名的其他应用容器，不会执行全局 Docker 清理。长期运维可按需清理已确认不再使用的旧 SCmap 镜像。
