# SCmap · TCR V/J Atlas

在人类泛疾病 T 细胞的作者 RNA UMAP 上探索 TCR 基因与细胞亚型的分布。

- CD8、CD4 独立浏览，支持研究来源筛选，统一使用 RNA–TCR 已匹配细胞。
- 支持 TRAV / TRAJ / TRBV / TRBJ 和同细胞同链 V+J 组合。
- 按基因看亚型，或按亚型查看基因排名；排名可按亚型内携带率或携带者亚型占比排序。
- 左图作者亚型注释，右图携带细胞沿用亚型颜色；百万细胞全量显示，视角联动。
- 颜色代表 RNA 亚型，非表达强度。所有比例是当前筛选队列的细胞加权描述。

## Linux 部署

见 [DEPLOY.md](DEPLOY.md)。服务器已安装 Git、Docker Engine、curl、Python ≥3.9 和 flock，并能拉取 GitHub 仓库和容器镜像后：

```bash
git clone git@github.com:zqywuxie/SCmap.git
cd SCmap
bash deploy.sh
```

默认通过 `http://服务器IP:10323/` 访问。之后再次执行 `bash deploy.sh`，自动拉取 main 并更新部署。公网访问推荐按部署文档配置 HTTPS。

## 本地查看

基因输入框同时支持搜索和选择。聚焦或点击箭头展开候选，候选按当前配对队列的携带数排列并展示细胞数。输入关键词后按上下方向键移动，Enter 选择，Esc 取消本次搜索。V+J 模式下两侧候选按同细胞的实际组合联动，每侧可单独清除。

```bash
python -m http.server 8765 --bind 127.0.0.1
```

打开 http://127.0.0.1:8765/ 。浏览器需启用 WebGL；网站不依赖 CDN 或 npm 构建。测试：`node --test stats.test.mjs`；部署数据校验：`python validate_data.py`。

## 数据

`data/` 只包含浏览器所需的 manifest 和 CD4/CD8 的坐标、分类代码、匹配标记与原 RNA 行号，约 28 MB 压缩文件，使用普通 Git，不需要 Git LFS。坐标与亚型来自原项目作者图谱，未重算 UMAP。RNA–TCR 匹配基于发布表中的 tcr 键；不额外代表 productive/UMI QC。该发布包含 1,024,993 个匹配常规 CD8 细胞，1,142,231 个匹配 CD4 聚合细胞。CD4 包含 Treg/CD40LG，MAIT 不纳入常规 CD8。

有效细胞要求所选位点调用明确；组合要求同一细胞同一链的 V 和 J 都明确且同时匹配。缺失、不确定均从有效分母排除。排名仅列出所选亚型实际观察到的基因／组合。亚型内携带率分母是该亚型有效细胞数；携带者亚型占比分母是当前全队列该基因携带数。零分母显示 `—`，集中程度须结合细胞支持数解读。

原始 H5AD、TCR 序列、cell_index 审计表、截图和其他分析结果均未打包到这个网站仓库。数据来源与再分发条件沿用原始发布方要求；此仓库不额外授予数据许可。
