# SCmap · TCR V/J Atlas

在人类 T 细胞的作者 RNA UMAP 上探索 TCR 基因与细胞亚型的分布。支持 Pan-disease 和 TABLO · Sureshchandra 2025 两套数据集，分别使用各自的原始坐标、注释和基因字典。

- CD8、CD4 独立浏览，支持研究来源筛选，统一使用 RNA–TCR 已匹配细胞。
- TABLO 支持 Blood、Tonsil 和两种组织合并筛选，同一供者跨组织合并计数。切换数据集会清除基因选择和排名搜索，保留浏览方向、谱系及基因模式。
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

`data/datasets.json` 注册可用数据集及各自的 manifest。Pan-disease 沿用 `data/manifest.json`、`data/CD4/` 和 `data/CD8/`；TABLO 使用 `data/TABLO/`。只打包浏览器需要的坐标、分类代码、匹配标记与源行索引，gzip 文件合计约 82 MB，使用普通 Git，不需要 Git LFS。两套数据分别校验、加载和缓存，不合并坐标或统计分母；不重算 UMAP。

| 数据集 | CD4 配对细胞 | 常规 CD8 配对细胞 | 注释与匹配规则 |
|---|---:|---:|---|
| Pan-disease | 1,142,231 | 1,024,993 | 作者 cell_subtype_v3；按发布的 tcr 键匹配，未额外进行 productive/UMI QC；CD4 包含 Treg/CD40LG |
| TABLO | 3,187,038 | 902,119 | 作者 annotation_L3；CSV 逐条核对后的 analysis_pair，要求高置信 productive 双链、有效 V/J 与 CDR3 |

TABLO 原始 RNA 共 4,416,277 个细胞，双链配对 4,193,343 个。网站展示其中 CD4/CD8 的 4,089,157 个配对细胞；MAIT、DP/DN/ProlifT 等其他群体保留在上游完整对象。CD4 包含 CD4-Naive、CD4-TCM、CD4-TEM、Tregs、TFH 和 GC-TFH；CD8 包含 CD8-Naive、CD8-TCM、CD8-TEM 和 CD8-TRM。双 α 链按 UMI 降序、reads 降序、contig_id 升序选主要 α 链，网站的 V/J 和 V+J 描述主要链调用。坐标由作者 float64 转为 WebGL float32，最大绝对误差约 3.49e-7；没有抽样或重新拟合。

TABLO 网站数据由 `script/visualization/prepare_tablo_explorer.py` 从整理版配对表及修正 H5AD 导出，在 `data/TABLO_Sureshchandra_2025/analysis/scmap` 留存源行映射、基因调用审计和独立核对结果。`validate_tablo_explorer.py` 逐细胞比较作者坐标、源细胞 ID、L3 注释、供者、组织和 V/J，并生成两种谱系、三种组织范围的单基因及组合参考结果。浏览器行号为按 manifest.samples 顺序拼接的全 RNA 行号，减去对应样本的 global_row_offset 即样本内行号；悬停提示直接展示样本内行号。

有效细胞要求所选位点调用明确；组合要求同一细胞同一链的 V 和 J 都明确且同时匹配。缺失、不确定均从有效分母排除。排名仅列出所选亚型实际观察到的基因／组合。亚型内携带率分母是该亚型有效细胞数；携带者亚型占比分母是当前全队列该基因携带数。零分母显示 `—`，集中程度须结合细胞支持数解读。

“携带者亚型占比”下方显示本亚型及当前全队列的携带患者/受试者人数，并显示最大单一患者贡献的细胞数及其占本亚型携带细胞的比例。患者身份按 `study_name + individual` 去重，同一研究内合并多个样本，跨研究分别计数。身份缺失的细胞计入细胞统计，并单独显示数量，患者人数只计身份明确者。同一患者可以涉及多个亚型，各亚型人数分别去重。选择基因或 V+J 后可展开患者贡献明细，按携带细胞数列出前 20 位，包含来源、个体标识和亚型构成。

TABLO 的 individual 使用统一 donor 标识，Donor7 的 CSV 别名 UCIMC-001 已在上游映射为 UCIMC001。Blood/Tonsil 共用同一供者身份；组织筛选同时更新细胞分母、携带人数和单人贡献。所有供者支持结果仍为细胞加权描述，未作供者等权或疾病效应推断。

原始 H5AD、TCR 序列、cell_index 审计表、截图和其他分析结果均未打包到这个网站仓库。数据来源与再分发条件沿用原始发布方要求；此仓库不额外授予数据许可。
