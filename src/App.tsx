import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts/core";
import type { EChartsOption } from "echarts";
import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Check,
  ChevronDown,
  Code2,
  Database,
  FileSpreadsheet,
  FlaskConical,
  GitBranch,
  Globe2,
  History,
  LayoutDashboard,
  LoaderCircle,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { api, ApiError } from "./api";
import type {
  ChartData,
  Comparison,
  Dataset,
  Operation,
  Version,
} from "./types";
type Lang = "zh" | "en";
echarts.use([
  BarChart,
  LineChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);
const colors = ["#9aa9a1", "#168468", "#d79b52"];
function Plot({ option, label }: { option: EChartsOption; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const chart = echarts.init(ref.current!);
    chart.setOption(option);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current!);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [option]);
  return <div className="plot" ref={ref} role="img" aria-label={label} />;
}
function categorical(
  labels: string[],
  series: { name: string; data: (number | null)[] }[],
  type = "bar",
  percent = false,
): EChartsOption {
  return {
    color: colors,
    tooltip: {
      trigger: "axis",
      valueFormatter: (v) => `${v ?? "—"}${percent ? "%" : ""}`,
    },
    legend: { bottom: 0, icon: "circle" },
    grid: { left: 58, right: 20, top: 22, bottom: 65 },
    xAxis: {
      type: "category",
      data: labels,
      axisLabel: { color: "#7c8580" },
      axisLine: { lineStyle: { color: "#e1e6e1" } },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        formatter: percent ? "{value}%" : "{value}",
        color: "#7c8580",
      },
      splitLine: { lineStyle: { color: "#edf0eb" } },
    },
    series: series.map((s) => ({
      ...s,
      type: type as "bar" | "line",
      barMaxWidth: 28,
      smooth: type === "line",
      itemStyle: { borderRadius: type === "bar" ? [4, 4, 0, 0] : 0 },
    })),
  };
}
export default function App() {
  const [lang, setLang] = useState<Lang>(() =>
    localStorage.getItem("pandas-lab-lang") === "en" ? "en" : "zh",
  );
  const t = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const [tab, setTab] = useState(0),
    [version, setVersion] = useState<Version | null>(null),
    [datasets, setDatasets] = useState<Dataset[]>([]),
    [health, setHealth] = useState(""),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [encoding, setEncoding] = useState("utf-8-sig");
  const [kind, setKind] = useState("fill_missing"),
    [column, setColumn] = useState(""),
    [value, setValue] = useState(""),
    [method, setMethod] = useState("median"),
    [operator, setOperator] = useState("eq"),
    [target, setTarget] = useState("numeric"),
    [coerce, setCoerce] = useState(false),
    [ascending, setAscending] = useState(true),
    [aggregate, setAggregate] = useState("sum"),
    [valueColumn, setValueColumn] = useState(""),
    [dedup, setDedup] = useState<string[]>([]);
  const [preview, setPreview] = useState<Version | null>(null),
    [affected, setAffected] = useState(false),
    [codeOpen, setCodeOpen] = useState(false),
    [compare, setCompare] = useState<Comparison | null>(null),
    [baseId, setBaseId] = useState(""),
    [compareCol, setCompareCol] = useState(""),
    [group, setGroup] = useState(""),
    [aMethod, setAMethod] = useState("drop"),
    [bMethod, setBMethod] = useState("median"),
    [aValue, setAValue] = useState("0"),
    [bValue, setBValue] = useState("0"),
    [inspection, setInspection] = useState<Version | null>(null);
  const [compareBase, setCompareBase] = useState<Version | null>(null);
  const [chartType, setChartType] = useState("bar"),
    [chartX, setChartX] = useState(""),
    [chartY, setChartY] = useState(""),
    [chartAgg, setChartAgg] = useState("sum"),
    [bins, setBins] = useState(12),
    [chart, setChart] = useState<ChartData | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const errors: Record<string, [string, string]> = {
    NETWORK_ERROR: [
      "无法连接服务，请确认后端已启动。",
      "Cannot reach the service. Check the backend is running.",
    ],
    NOT_FOUND: [
      "数据版本不存在，请重新选择数据集。",
      "Version not found. Select a dataset again.",
    ],
    EMPTY_FILE: ["文件为空。", "The file is empty."],
    FILE_TOO_LARGE: ["文件超过 10 MB 限制。", "File exceeds the 10 MB limit."],
    TOO_MANY_ROWS: ["最多支持 50,000 行。", "Up to 50,000 rows supported."],
    TOO_MANY_COLUMNS: ["最多支持 100 列。", "Up to 100 columns supported."],
    INVALID_CSV: [
      "无法读取 CSV，请检查文件格式。",
      "Cannot read this CSV. Check the file format.",
    ],
    ENCODING_ERROR: [
      "文件编码不匹配，请更换编码。",
      "Encoding mismatch. Try another encoding.",
    ],
    RESERVED_COLUMN: [
      "文件包含保留字段 _row_id，请先重命名。",
      "Rename the reserved column _row_id before uploading.",
    ],
    INVALID_COLUMN: ["请选择有效字段。", "Choose a valid field."],
    INVALID_OPERATION: ["该操作无效。", "Invalid operation."],
    INVALID_VALUE: [
      "参数无效，请检查输入。",
      "Invalid parameter. Check your input.",
    ],
    NUMERIC_REQUIRED: [
      "此操作需要数值字段。",
      "This operation requires a numeric field.",
    ],
    ALL_MISSING: [
      "该列全部为空，无法计算均值或中位数。",
      "This column is entirely missing; mean or median is unavailable.",
    ],
    CONVERSION_FAILED: [
      "部分值无法转换，可选择将无效值设为空。",
      "Some values cannot be converted. Try coercing invalid values to missing.",
    ],
    INVALID_AGGREGATE: [
      "请选择有效的聚合方式。",
      "Choose a valid aggregation.",
    ],
  };
  async function run(fn: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (alive.current)
        setError(e instanceof ApiError ? e.code : "NETWORK_ERROR");
    } finally {
      if (alive.current) setPending(false);
    }
  }
  function selectVersion(v: Version) {
    setError("");
    setVersion(v);
    setPreview(null);
    setAffected(false);
    setChart(null);
    setBaseId(v.id);
    setCompareBase(v);
    setCompare(null);
    setInspection(null);
    setGroup("");
    setCompareCol(v.columns.find((c) => c.kind === "numeric")?.name || "");
    localStorage.setItem("pandas-lab-version", v.id);
  }
  async function refreshDatasets() {
    setDatasets(await api<Dataset[]>("/datasets"));
  }
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    setPending(true);
    (async () => {
      try {
        const h = await api<{ pandas_version: string }>("/health");
        const ds = await api<Dataset[]>("/datasets");
        if (cancelled) return;
        setHealth(h.pandas_version);
        setDatasets(ds);
        const id = localStorage.getItem("pandas-lab-version");
        if (id) {
          try {
            const v = await api<Version>("/versions/" + id);
            if (!cancelled) selectVersion(v);
          } catch {
            localStorage.removeItem("pandas-lab-version");
          }
        }
      } catch {
        if (!cancelled) setError("NETWORK_ERROR");
      } finally {
        if (!cancelled) setPending(false);
      }
    })();
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    localStorage.setItem("pandas-lab-lang", lang);
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.title =
      lang === "zh"
        ? "Pandas Lab · 数据可视化工作台"
        : "Pandas Lab · Data workspace";
  }, [lang]);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [tab]);
  useEffect(() => {
    if (!version) return;
    const cs = version.columns;
    const n = cs.find((c) => c.kind === "numeric")?.name || "";
    if (!cs.some((c) => c.name === column)) setColumn(cs.find((c) => c.kind === "numeric" && c.missing > 0)?.name || n || cs[0]?.name || "");
    if (!cs.some((c) => c.name === valueColumn)) setValueColumn(n);
    if (!cs.some((c) => c.name === compareCol)) setCompareCol(n);
    if (!cs.some((c) => c.name === chartX)) setChartX(cs[0]?.name || "");
    if (!cs.some((c) => c.name === chartY)) setChartY(n);
    setDedup((d) => d.filter((x) => cs.some((c) => c.name === x)));
  }, [version?.id]);
  useEffect(() => {
    setPreview(null);
  }, [
    kind,
    column,
    value,
    method,
    operator,
    target,
    coerce,
    ascending,
    aggregate,
    valueColumn,
    dedup,
  ]);
  useEffect(() => {
    if (!version) return;
    const cs = version.columns;
    const numericOnly = chartType === "scatter" || chartType === "histogram";
    if (
      !cs.some(
        (c) => c.name === chartX && (!numericOnly || c.kind === "numeric"),
      )
    )
      setChartX(
        cs.find((c) => !numericOnly || c.kind === "numeric")?.name || "",
      );
    if (
      chartType === "scatter" &&
      !cs.some((c) => c.name === chartY && c.kind === "numeric")
    )
      setChartY(cs.find((c) => c.kind === "numeric")?.name || "");
  }, [chartType, version?.id]);
  const opNames: Record<string, [string, string]> = {
    filter: ["筛选记录", "Filter rows"],
    sort: ["排序", "Sort"],
    convert: ["类型转换", "Convert type"],
    deduplicate: ["去除重复", "Remove duplicates"],
    fill_missing: ["缺失值处理", "Missing values"],
    groupby: ["分组聚合", "Group & aggregate"],
  };
  const methodNames: Record<string, [string, string]> = {
    drop: ["删除缺失记录", "Drop missing rows"],
    median: ["中位数填充", "Fill with median"],
    mean: ["均值填充", "Fill with mean"],
    constant: ["常数填充", "Fill with constant"],
  };
  function opName(op: Operation | null) {
    if (!op) return t("原始数据", "Original data");
    const pair = opNames[op.type];
    return `${pair ? t(...pair) : op.type}${op.params.column ? " · " + String(op.params.column) : ""}${op.type === "fill_missing" ? " · " + t(...(methodNames[String(op.params.method)] || ["", ""])) : ""}`;
  }
  function operation(): Operation {
    const params: Record<string, unknown> =
      kind === "filter"
        ? {
            column,
            operator,
            ...(!["is_null", "not_null"].includes(operator) ? { value } : {}),
          }
        : kind === "sort"
          ? { column, ascending }
          : kind === "convert"
            ? { column, target, errors: coerce ? "coerce" : "raise" }
            : kind === "deduplicate"
              ? { columns: dedup }
              : kind === "fill_missing"
                ? {
                    column,
                    method,
                    ...(method === "constant" ? { value } : {}),
                  }
                : { column, value_column: valueColumn, aggregate };
    return { type: kind, params };
  }
  async function load(id: string, page = 1, only = false) {
    const v = await api<Version>(
      `/versions/${id}?page=${page}&page_size=20&affected_only=${only}`,
    );
    setVersion(v);
  }
  function downloadConfig() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            version_id: version?.id,
            type: chartType,
            x: chartX,
            y: chartY || null,
            aggregate: chartAgg,
            bins,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "chart-config.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  const cols = version?.columns || [],
    numeric = cols.filter((c) => c.kind === "numeric");
  const shown = preview || version;
  const missingColumn = cols.find((c) => c.missing > 0 && c.kind === "numeric") || cols.find((c) => c.missing > 0);
  const suggestedX = cols.find((c) => c.kind !== "numeric")?.name || cols[0]?.name || "";
  const suggestedY = numeric[0]?.name || "";
  function startCleaning(type: string, field = "") {
    setKind(type);
    setColumn(field || missingColumn?.name || cols[0]?.name || "");
    setMethod(cols.find((c) => c.name === field)?.kind === "numeric" ? "median" : "drop");
    setDedup([]);
    setPreview(null);
    setAffected(false);
    setTab(1);
  }
  function quickChart() {
    if (!version || !suggestedX) return;
    run(async () => {
      setChart(null);
      setChartType("bar");
      setChartX(suggestedX);
      setChartY(suggestedY);
      setChartAgg("sum");
      setTab(3);
      setChart(await api<ChartData>(`/versions/${version.id}/chart`, {
        type: "bar", x: suggestedX, y: suggestedY || null, aggregate: "sum", bins: 12,
      }));
    });
  }
  const operationHelp: Record<string, [string, string]> = {
    fill_missing: ["空值就是表格里没有填写的单元格。先选一列，再决定删除这些行，还是填入一个值。中位数是把已有数值排序后位于中间的数。", "Missing values are blank cells. Choose a column, then remove its blank rows or fill them. The median is the middle value after sorting."],
    deduplicate: ["去掉内容完全相同的重复行，只保留一条。不勾选列时，会比较所有列；勾选后，只按选中的列判断重复。", "Keep one copy of repeated rows. With no columns selected, compare every column; otherwise compare only the selected columns."],
    filter: ["只留下符合条件的行。例如选择“用电量 > 30000”，就能查看高用电量记录。", "Keep rows matching a condition, such as energy consumption greater than 30,000."],
    sort: ["按一列重新排列整张表。例如把用电量从大到小排列，找到耗电最多的记录。", "Reorder the table by a column, for example highest to lowest energy use."],
    convert: ["把一列转换为数字、文字或日期，方便后续计算。请先预览，检查是否有无法转换的值。", "Convert a column to numbers, text or dates. Preview first to check values that cannot be converted."],
    groupby: ["把同一类别的记录合并计算。例如按楼宇分组、对用电量求和，得到每栋楼的总用电量。", "Combine rows by category. For example, group by building and sum energy use to get a total per building."],
  };
  const comparisonColumns = compareBase?.columns || cols;
  const comparisonOptions = (numericOnly = false) =>
    comparisonColumns
      .filter((c) => !numericOnly || c.kind === "numeric")
      .map((c) => (
        <option key={c.name} value={c.name}>
          {c.name}
        </option>
      ));
  const fieldOptions = (numericOnly = false) =>
    (numericOnly ? numeric : cols).map((c) => (
      <option key={c.name} value={c.name}>
        {c.name}
      </option>
    ));
  const label = (zh: string, en: string, node: React.ReactNode) => (
    <label className="control">
      <span>{t(zh, en)}</span>
      {node}
    </label>
  );
  const aggSelect = (v: string, set: (s: string) => void) => (
    <select value={v} onChange={(e) => set(e.target.value)}>
      {["sum", "mean", "median", "count", "min", "max"].map((x, i) => (
        <option key={x} value={x}>
          {t(
            ["求和", "均值", "中位数", "计数", "最小值", "最大值"][i],
            ["Sum", "Mean", "Median", "Count", "Minimum", "Maximum"][i],
          )}
        </option>
      ))}
    </select>
  );
  function dataTable(v: Version, interactive = false) {
    const changed = new Set(v.changed_ids),
      removed = new Set(v.removed_ids);
    return (
      <>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="row-num">#</th>
                {v.columns.map((c) => (
                  <th key={c.name}>
                    <span>{c.name}</span>
                    <small>{c.dtype}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {v.preview.map((row, i) => (
                <tr
                  key={String(row._row_id ?? i)}
                  className={
                    removed.has(Number(row._row_id))
                      ? "removed"
                      : changed.has(Number(row._row_id))
                        ? "changed"
                        : ""
                  }
                >
                  <td className="row-num">
                    {(v.page - 1) * v.page_size + i + 1}
                  </td>
                  {v.columns.map((c) => (
                    <td key={c.name}>
                      {row[c.name] === null || row[c.name] === undefined ? (
                        <span className="null">{t("空值", "null")}</span>
                      ) : (
                        String(row[c.name])
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!v.preview.length && (
            <div className="table-empty">
              {t("没有符合条件的记录", "No matching records")}
            </div>
          )}
        </div>
        <div className="table-footer">
          <span>
            {t("共", "Total")} {v.total_preview_rows.toLocaleString()}{" "}
            {t("条记录", "rows")}{" "}
            {preview === v && (
              <b className="preview-tag">
                {t("预览 · 尚未应用", "Preview · not applied")}
              </b>
            )}
          </span>
          {interactive && (
            <div className="pager">
              <button
                aria-label={t("上一页", "Previous page")}
                disabled={pending || v.page <= 1 || !!preview}
                onClick={() => run(() => load(v.id, v.page - 1, affected))}
              >
                <ArrowLeft size={15} />
              </button>
              <span>
                {v.page} /{" "}
                {Math.max(1, Math.ceil(v.total_preview_rows / v.page_size))}
              </span>
              <button
                aria-label={t("下一页", "Next page")}
                disabled={
                  pending ||
                  v.page * v.page_size >= v.total_preview_rows ||
                  !!preview
                }
                onClick={() => run(() => load(v.id, v.page + 1, affected))}
              >
                <ArrowRight size={15} />
              </button>
            </div>
          )}
        </div>
      </>
    );
  }
  const title = [
    t("把一张表，变成看得懂的图。", "Turn your table into a useful chart."),
    t("先预览，再修改表格。", "Preview, then update your table."),
    t("空值删掉还是补上？比较后再决定。", "Remove or fill blanks? Compare first."),
    t("选好横轴和纵轴，就能画图。", "Choose your axes and create a chart."),
  ][tab];
  return (
    <div className="app">
      <aside className="sidebar">
        <a
          className="brand"
          aria-label="Pandas Lab"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setError("");
            setTab(0);
          }}
        >
          <span className="brand-mark">
            <FlaskConical size={23} />
          </span>
          <span>
            Pandas<span className="brand-light"> Lab</span>
            <small>DATA EXPLORATION STUDIO</small>
          </span>
        </a>
        <div className="nav-label">{t("工作空间", "WORKSPACE")}</div>
        <nav>
          {[LayoutDashboard, SlidersHorizontal, GitBranch, BarChart3].map(
            (Icon, i) => (
              <button
                key={i}
                aria-label={
                  [
                    t("1 · 查看表格", "1 · View table"),
                    t("2 · 清理数据", "2 · Clean data"),
                    t("选做 · 对比处理方式", "Optional · Compare"),
                    t("3 · 画图与下载", "3 · Chart & download"),
                  ][i]
                }
                className={tab === i ? "nav-item active" : "nav-item"}
                onClick={() => {
                  setError("");
                  setTab(i);
                }}
              >
                <Icon size={19} />
                <span>
                  {
                    [
                      t("1 · 查看表格", "1 · View table"),
                      t("2 · 清理数据", "2 · Clean data"),
                      t("选做 · 对比处理方式", "Optional · Compare"),
                      t("3 · 画图与下载", "3 · Chart & download"),
                    ][i]
                  }
                </span>
                {tab === i && <span className="nav-dot" />}
              </button>
            ),
          )}
        </nav>
        <div className="sidebar-note">
          <Sparkles size={19} />
          <strong>{t("不知道从哪开始？", "Not sure where to start?")}</strong>
          <p>
            {t(
              "先在首页查看表格，再点击问题旁的按钮。没有自己的数据，也可以用内置示例。",
              "View the table, then use the buttons beside each issue. Try the demo if you do not have a CSV.",
            )}
          </p>
          <span>PANDAS · VISUAL · REPRODUCIBLE</span>
        </div>
        <div className="connection">
          <span className={health ? "status-dot" : "status-dot offline"} />
          <div>
            {t("本地计算引擎", "Local computation")}
            <small>
              {health
                ? `pandas ${health}`
                : t("服务未连接", "Service disconnected")}
            </small>
          </div>
          <Database size={16} />
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>{t("工作空间", "Workspace")}</span>
            <span>/</span>
            <strong>
              {version?.dataset_name ||
                t("未选择数据集", "No dataset selected")}
            </strong>
          </div>
          <div className="top-actions">
            {datasets.length > 0 && (
              <label className="dataset-picker">
                <Database size={15} />
                <select
                  aria-label={t("选择数据集", "Select dataset")}
                  value={version?.dataset_id || ""}
                  disabled={pending}
                  onChange={(e) => {
                    const ds = datasets.find((d) => d.id === e.target.value);
                    if (ds)
                      run(async () => {
                        selectVersion(
                          await api<Version>(
                            "/versions/" + ds.latest_version_id,
                          ),
                        );
                        setCompare(null);
                      });
                  }}
                >
                  <option value="" disabled>
                    {t("选择数据集", "Select dataset")}
                  </option>
                  {datasets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} />
              </label>
            )}
            <button
              className="language"
              onClick={() => setLang(lang === "zh" ? "en" : "zh")}
            >
              <Globe2 size={16} />
              {lang === "zh" ? "中文 / EN" : "EN / 中文"}
            </button>
          </div>
        </header>
        <main>
          <fieldset disabled={pending} className="workspace-fields">
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  {
                    [
                      "WORKSPACE OVERVIEW",
                      "TRANSFORMATION STUDIO",
                      "COMPARE SCENARIOS",
                      "ANALYSIS & EXPORT",
                    ][tab]
                  }
                </div>
                <h1>{title}</h1>
                <p>
                  {
                    [
                      t(
                        "不用写代码：上传 CSV 表格，清理重复行和空值，再生成图表、下载结果。",
                        "Upload a CSV, clean repeated rows and blanks, then create a chart and download the result. No code needed.",
                      ),
                      t(
                        "① 选择要做的操作 → ② 点击“预览修改”检查结果 → ③ 确认后应用。原表保留，可撤销。",
                        "1. Choose an operation → 2. Preview changes → 3. Apply when ready. The original is preserved and changes can be undone.",
                      ),
                      t(
                        "这是选做步骤：同一列空值，分别尝试“删除”和“填充”，看看行数、平均值有什么变化。",
                        "Optional: try removing and filling blanks in the same column, then compare row counts and averages.",
                      ),
                      t(
                        "横轴选类别（如楼宇），纵轴选数字（如用电量）。生成图表后，可在下方下载处理后的表格。",
                        "Choose a category for X (such as building) and a number for Y (such as energy use). Download the cleaned table below.",
                      ),
                    ][tab]
                  }
                </p>
              </div>
              <button
                className="primary"
                disabled={pending}
                onClick={() => fileRef.current?.click()}
              >
                <Plus size={17} />
                {t("上传 CSV 表格", "Upload a CSV table")}
              </button>
            </div>
            <nav className="workflow" aria-label={t("操作步骤", "Workflow")}>
              {[[0, t("1  查看表格", "1  View table"), t("上传 CSV 或用示例", "Upload CSV or use the demo")], [1, t("2  清理数据", "2  Clean data"), t("处理重复行和空值", "Handle repeats and blanks")], [3, t("3  画图与下载", "3  Chart & download"), t("比较数值，保存结果", "Compare values and save results")]].map(([step, name, desc]) => (
                <button key={Number(step)} className={tab === step ? "workflow-step current" : "workflow-step"} aria-current={tab === step ? "step" : undefined} disabled={!version && step !== 0} onClick={() => { setError(""); setTab(Number(step)); }}>
                  <strong>{name}</strong><span>{desc}</span><ArrowRight size={17} />
                </button>
              ))}
            </nav>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file)
                  run(async () => {
                    const form = new FormData();
                    form.append("file", file);
                    form.append("encoding", encoding);
                    selectVersion(await api<Version>("/upload", form));
                    await refreshDatasets();
                    setCompare(null);
                    setTab(0);
                  });
              }}
            />
            {error && (
              <div className="error" role="alert">
                <span>{t(...(errors[error] || [error, error]))}</span>
                <button
                  aria-label={t("关闭错误", "Dismiss error")}
                  onClick={() => setError("")}
                >
                  <X size={17} />
                </button>
              </div>
            )}
            {pending && (
              <div className="pending" role="status">
                <LoaderCircle size={15} className="spin" />
                {t("正在计算…", "Working…")}
              </div>
            )}
            {!version ? (
              <section className="empty-workspace">
                <div className="empty-graphic">
                  <div className="floating-chip">
                    <Activity size={18} />
                    <span>pandas</span>
                  </div>
                  <FileSpreadsheet size={72} strokeWidth={1.1} />
                  <div className="mini-bars">
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
                <div className="eyebrow">YOUR NEXT DISCOVERY STARTS HERE</div>
                <h2>
                  {t(
                    "第一次用？先用示例走一遍。",
                    "First time? Start with the demo.",
                  )}
                </h2>
                <p>
                  {t(
                    "示例是一张楼宇用电表。你将检查重复行、处理空值，最后比较各楼宇用电量。也可以上传自己的 CSV。",
                    "Use a building energy table to check duplicates, handle blanks and compare energy use. Or upload your own CSV.",
                  )}
                </p>
                <div className="empty-buttons">
                  <button
                    className="primary"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        selectVersion(await api<Version>("/demo", {}));
                        await refreshDatasets();
                      })
                    }
                  >
                    <Sparkles size={17} />
                    {t("载入校园能耗示例", "Explore campus energy demo")}
                  </button>
                  <button
                    className="secondary"
                    disabled={pending}
                    onClick={() => fileRef.current?.click()}
                  >
                    <Upload size={17} />
                    {t("上传 CSV 文件", "Upload a CSV")}
                  </button>
                </div>
                <div className="encoding-inline">
                  <span>{t("上传编码", "CSV encoding")}</span>
                  <select
                    value={encoding}
                    onChange={(e) => setEncoding(e.target.value)}
                  >
                    <option value="utf-8-sig">UTF-8 / UTF-8 BOM</option>
                    <option value="gb18030">GB18030 / GBK</option>
                  </select>
                  <span>CSV · ≤ 10 MB · 50,000 {t("行", "rows")}</span>
                </div>
                <div className="empty-features">
                  {[
                    [Database, t("真实 pandas 计算", "Powered by pandas")],
                    [GitBranch, t("独立方案对比", "Independent scenarios")],
                    [Code2, t("可复现代码导出", "Reproducible Python")],
                  ].map(([Icon, text], i) => {
                    const I = Icon as typeof Database;
                    return (
                      <span key={i}>
                        <I size={17} />
                        {text as string}
                      </span>
                    );
                  })}
                </div>
              </section>
            ) : (
              <>
                {tab === 0 && (
                  <>
                    <section className="start-panel">
                      <div className="start-intro">
                        <span className="section-kicker">{t("从这里开始", "START HERE")}</span>
                        <h2>{version.dataset_name}</h2>
                        <p>{version.rows} {t("行", "rows")} · {cols.length} {t("列", "columns")} · {t("下面是自动检查结果。选择一项，就能开始操作。", "Choose an action below to get started.")}</p>
                      </div>
                      <div className="task-cards">
                        <article className="task-card">
                          <span className="task-number">01</span>
                          <h3>{version.duplicates > 0 ? t(`有 ${version.duplicates} 条重复行`, `${version.duplicates} repeated rows`) : t("没有发现重复行", "No repeated rows found")}</h3>
                          <p>{t("同一条记录出现多次，求和时可能会重复计算。先检查，再决定是否删除。", "Repeated records may inflate totals. Inspect them before removing copies.")}</p>
                          <button className="secondary" disabled={!version.duplicates} onClick={() => startCleaning("deduplicate")}>
                            {t("检查并去掉重复行", "Review repeated rows")} <ArrowRight size={16} />
                          </button>
                        </article>
                        <article className="task-card">
                          <span className="task-number">02</span>
                          <h3>{t(`有 ${version.total_missing} 个空单元格`, `${version.total_missing} blank cells`)}</h3>
                          <p>{missingColumn ? t(`例如“${missingColumn.name}”有 ${missingColumn.missing} 个空值。可以填入一个值，或删除对应的行。`, `“${missingColumn.name}” has ${missingColumn.missing} blanks. Fill them or remove those rows.`) : t("这张表没有空值，可以继续画图。", "There are no blanks. You can continue to charts.")}</p>
                          <button className="secondary" disabled={!missingColumn} onClick={() => startCleaning("fill_missing", missingColumn?.name)}>
                            {t("看看空值怎么处理", "Handle blank cells")} <ArrowRight size={16} />
                          </button>
                        </article>
                        <article className="task-card chart-task">
                          <span className="task-number">03</span>
                          <h3>{suggestedY ? t(`比较不同${suggestedX}的${suggestedY}`, `Compare ${suggestedY} by ${suggestedX}`) : t("看看每个类别有多少条记录", "Count records by category")}</h3>
                          <p>{t("先试一张柱状图。系统帮你选好字段，之后还可以自己调整。", "Start with a bar chart. Fields are selected for you and can be changed afterwards.")}</p>
                          <button className="primary" disabled={!suggestedX} onClick={quickChart}>
                            {t("直接生成这张图", "Create this chart")} <ArrowRight size={16} />
                          </button>
                        </article>
                      </div>
                      <p className="start-footnote">{t("清理不是必选步骤：先确认这些数据是否有问题。直接画图会使用当前表格（包含尚未处理的重复行和空值）。", "Cleaning is optional: check whether the data needs it. Quick charts use the current table, including unresolved duplicates and blanks.")}</p>
                    </section>
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>{t("这就是你正在处理的表格", "This is your current table")}</h2>
                          <p>
                            {version.dataset_name}{" "}
                            <span className="subtle">
                              ·{" "}
                              {t(
                                "每一行是一条记录；标有“空值”的格子没有数据",
                                "Each row is a record; cells marked null have no value",
                              )}
                            </span>
                          </p>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => setTab(1)}
                        >
                          {t("选择清理操作", "Choose a cleaning operation")}
                          <ArrowRight size={16} />
                        </button>
                      </div>
                      {dataTable(version, true)}
                    </section>
                    <details className="panel field-details">
                      <summary>{t("查看每一列的统计信息（可选）", "Column statistics (optional)")}</summary>
                      <div className="panel-heading">
                        <div>
                          <h2>{t("字段概览", "Field overview")}</h2>
                          <p>
                            {t(
                              "先了解结构，再开始分析。",
                              "Understand the structure before diving in.",
                            )}
                          </p>
                        </div>
                        <span className="badge">
                          {cols.length} {t("个字段", "fields")}
                        </span>
                      </div>
                      <div className="field-grid">
                        {cols.map((c) => (
                          <article className="field-card" key={c.name}>
                            <div>
                              <span className={"type-icon " + c.kind}>
                                {c.kind === "numeric"
                                  ? "#"
                                  : c.kind === "date"
                                    ? "◷"
                                    : "Aa"}
                              </span>
                              <strong>{c.name}</strong>
                              <span className="dtype">{c.dtype}</span>
                            </div>
                            <div className="field-meta">
                              <span>
                                {t("唯一值", "Unique")} <b>{c.unique}</b>
                              </span>
                              <span>
                                {t("缺失", "Missing")}{" "}
                                <b className={c.missing ? "amber" : ""}>
                                  {c.missing}
                                </b>
                              </span>
                            </div>
                            <div className="quality-track">
                              <i
                                style={{
                                  width: `${version.rows ? Math.max(0, 100 - (c.missing / version.rows) * 100) : 0}%`,
                                }}
                              />
                            </div>
                            <small>
                              {c.stats
                                ? `${t("均值", "Mean")} ${c.stats.mean === null ? "—" : Number(c.stats.mean.toFixed(2)).toLocaleString()} · ${t("范围", "Range")} ${c.stats.min ?? "—"} – ${c.stats.max ?? "—"}`
                                : t("文本 / 日期字段", "Text / date field")}
                            </small>
                          </article>
                        ))}
                      </div>
                    </details>
                    <div className="encoding-inline bottom-encoding">
                      <span>{t("下次上传编码", "Next upload encoding")}</span>
                      <select
                        value={encoding}
                        onChange={(e) => setEncoding(e.target.value)}
                      >
                        <option value="utf-8-sig">UTF-8 / BOM</option>
                        <option value="gb18030">GB18030 / GBK</option>
                      </select>
                    </div>
                  </>
                )}
                {tab === 1 && (
                  <>
                    <div className="next-action">
                      <div><strong>{preview ? t("预览已就绪，还没有修改你的表格", "Preview ready — the table has not changed") : version.parent_id ? t("当前表格已保存，可以继续下一步", "Your current table is saved") : t(`当前操作：${opNames[kind][0]}`, `Selected: ${opNames[kind][1]}`)}</strong>
                      <p>{preview ? t(`应用后：${version.rows} 行 → ${preview.rows} 行；空值 ${version.total_missing} 个 → ${preview.total_missing} 个。检查下方表格，再点击“确认应用修改”。`, `After applying: ${version.rows} → ${preview.rows} rows; ${version.total_missing} → ${preview.total_missing} blank cells. Review the table, then apply.`) : t("不确定空值该删还是该补？可以先比较两种方式。处理完成后，继续画图。", "Unsure whether to remove or fill blanks? Compare both methods first. Continue to charts when ready.")}</p></div>
                      <div className="inline-actions"><button className="secondary" onClick={() => setTab(2)}>{t("比较两种处理方式", "Compare methods")}</button><button className="primary" onClick={quickChart} disabled={!suggestedX}>{preview ? t("用已保存的数据画图", "Chart saved data") : t("下一步：生成图表", "Next: create a chart")}<ArrowRight size={16} /></button></div>
                    </div>
                    <div className="transform-grid">
                      <section className="panel operation-panel">
                        <div className="panel-heading">
                          <h2>{t("① 你想对表格做什么？", "1. What would you like to do?")}</h2>
                          <SlidersHorizontal size={17} />
                        </div>
                        <div className="op-list">
                          {Object.entries(opNames).map(([key, names]) => (
                            <button
                              key={key}
                              className={kind === key ? "op active" : "op"}
                              onClick={() => setKind(key)}
                              disabled={pending}
                            >
                              {t(...names)}
                              <ArrowRight size={14} />
                            </button>
                          ))}
                        </div>
                        <div className="operation-help"><strong>{t(...opNames[kind])}</strong><p>{t(...operationHelp[kind])}</p></div>
                        <div className="parameters">
                          {kind !== "deduplicate" &&
                            label(
                              kind === "groupby" ? "分组字段" : "目标字段",
                              kind === "groupby"
                                ? "Group field"
                                : "Target field",
                              <select
                                value={column}
                                onChange={(e) => setColumn(e.target.value)}
                              >
                                {fieldOptions()}
                              </select>,
                            )}
                          {kind === "fill_missing" && (
                            <>
                              {label(
                                "处理方式",
                                "Method",
                                <select
                                  value={method}
                                  onChange={(e) => setMethod(e.target.value)}
                                >
                                  {Object.entries(methodNames).map(([m, n]) => (
                                    <option key={m} value={m}>
                                      {t(...n)}
                                    </option>
                                  ))}
                                </select>,
                              )}
                              {method === "constant" &&
                                label(
                                  "填充值",
                                  "Fill value",
                                  <input
                                    value={value}
                                    onChange={(e) => setValue(e.target.value)}
                                  />,
                                )}
                            </>
                          )}
                          {kind === "filter" && (
                            <>
                              {label(
                                "条件",
                                "Condition",
                                <select
                                  value={operator}
                                  onChange={(e) => setOperator(e.target.value)}
                                >
                                  {[
                                    "eq",
                                    "ne",
                                    "gt",
                                    "gte",
                                    "lt",
                                    "lte",
                                    "contains",
                                    "is_null",
                                    "not_null",
                                  ].map((x, i) => (
                                    <option key={x} value={x}>
                                      {t(
                                        [
                                          "等于",
                                          "不等于",
                                          "大于",
                                          "大于等于",
                                          "小于",
                                          "小于等于",
                                          "包含文本",
                                          "为空",
                                          "非空",
                                        ][i],
                                        [
                                          "Equals",
                                          "Not equal",
                                          "Greater than",
                                          "At least",
                                          "Less than",
                                          "At most",
                                          "Contains",
                                          "Is missing",
                                          "Is present",
                                        ][i],
                                      )}
                                    </option>
                                  ))}
                                </select>,
                              )}
                              {!["is_null", "not_null"].includes(operator) &&
                                label(
                                  "比较值",
                                  "Value",
                                  <input
                                    value={value}
                                    onChange={(e) => setValue(e.target.value)}
                                  />,
                                )}
                            </>
                          )}
                          {kind === "sort" &&
                            label(
                              "排序方式",
                              "Order",
                              <select
                                value={String(ascending)}
                                onChange={(e) =>
                                  setAscending(e.target.value === "true")
                                }
                              >
                                <option value="true">
                                  {t("升序", "Ascending")}
                                </option>
                                <option value="false">
                                  {t("降序", "Descending")}
                                </option>
                              </select>,
                            )}
                          {kind === "convert" && (
                            <>
                              {label(
                                "转换为",
                                "Convert to",
                                <select
                                  value={target}
                                  onChange={(e) => setTarget(e.target.value)}
                                >
                                  <option value="numeric">
                                    {t("数值", "Numeric")}
                                  </option>
                                  <option value="date">
                                    {t("日期", "Date")}
                                  </option>
                                  <option value="string">
                                    {t("文本", "Text")}
                                  </option>
                                </select>,
                              )}
                              <label className="checkbox">
                                <input
                                  type="checkbox"
                                  checked={coerce}
                                  onChange={(e) => setCoerce(e.target.checked)}
                                />
                                {t(
                                  "将无效值设为空",
                                  "Set invalid values to missing",
                                )}
                              </label>
                            </>
                          )}
                          {kind === "deduplicate" && (
                            <>
                              <p className="hint">
                                {t(
                                  "留空按全部字段去重，保留首次出现的记录。",
                                  "Leave unchecked to use all fields. Keep the first occurrence.",
                                )}
                              </p>
                              {cols.map((c) => (
                                <label className="checkbox" key={c.name}>
                                  <input
                                    type="checkbox"
                                    checked={dedup.includes(c.name)}
                                    onChange={(e) =>
                                      setDedup(
                                        e.target.checked
                                          ? [...dedup, c.name]
                                          : dedup.filter((x) => x !== c.name),
                                      )
                                    }
                                  />
                                  {c.name}
                                </label>
                              ))}
                            </>
                          )}
                          {kind === "groupby" && (
                            <>
                              {label(
                                "统计字段",
                                "Value field",
                                <select
                                  value={valueColumn}
                                  onChange={(e) =>
                                    setValueColumn(e.target.value)
                                  }
                                >
                                  {fieldOptions()}
                                </select>,
                              )}
                              {label(
                                "聚合方式",
                                "Aggregation",
                                aggSelect(aggregate, setAggregate),
                              )}
                              <p className="hint">
                                {t(
                                  "聚合将创建新记录，原始行级追踪结束。",
                                  "Aggregation creates new records; original row tracking ends.",
                                )}
                              </p>
                            </>
                          )}
                          <button
                            className="secondary full"
                            disabled={pending}
                            onClick={() =>
                              run(async () => {
                                setPreview(
                                  await api<Version>(
                                    `/versions/${version.id}/preview`,
                                    operation(),
                                  ),
                                );
                              })
                            }
                          >
                            <Search size={16} />
                            {t("② 预览修改", "2. Preview changes")}
                          </button>
                          <button
                            className="primary full"
                            disabled={pending || !preview}
                            onClick={() =>
                              run(async () => {
                                selectVersion(
                                  await api<Version>(
                                    `/versions/${version.id}/operations`,
                                    operation(),
                                  ),
                                );
                                await refreshDatasets();
                              })
                            }
                          >
                            <Check size={16} />
                            {preview
                              ? t("③ 确认应用修改", "3. Apply changes")
                              : t("③ 应用（请先预览）", "3. Apply (preview first)")}
                          </button>
                        </div>
                      </section>
                      <section className="panel working-data">
                        <div className="panel-heading">
                          <div>
                            <h2>
                              {preview
                                ? t("处理预览", "Operation preview")
                                : t("当前数据", "Current data")}
                            </h2>
                            <p>
                              {shown?.rows.toLocaleString()} {t("行", "rows")} ·{" "}
                              {t("受影响", "Affected")} {shown?.affected_rows}{" "}
                              {t("行", "rows")}
                            </p>
                          </div>
                          <div className="inline-actions">
                            {preview ? (
                              <button
                                className="text-button"
                                onClick={() => setPreview(null)}
                              >
                                {t("取消预览", "Cancel preview")}
                                <X size={15} />
                              </button>
                            ) : (
                              <label className="checkbox">
                                <input
                                  type="checkbox"
                                  checked={affected}
                                  disabled={pending}
                                  onChange={(e) => {
                                    const next = e.target.checked;
                                    run(async () => {
                                      await load(version.id, 1, next);
                                      setAffected(next);
                                    });
                                  }}
                                />
                                {t("仅看影响记录", "Affected only")}
                              </label>
                            )}
                          </div>
                        </div>
                        <div className="legend-note">
                          <i className="changed-dot" />
                          {t("修改的记录", "Changed rows")}
                          <i className="removed-dot" />
                          {t(
                            "删除的记录（保留供检查）",
                            "Removed rows (retained for inspection)",
                          )}
                        </div>
                        {shown && dataTable(shown, true)}
                      </section>
                    </div>
                    <section className="panel history-panel">
                      <div className="panel-heading">
                        <div>
                          <h2>
                            <History size={17} />
                            {t("处理历史", "Transformation history")}
                          </h2>
                          <p>
                            {t(
                              "每一步生成独立版本，可回到任何已记录步骤。",
                              "Each step creates an independent version. Return to any recorded step.",
                            )}
                          </p>
                        </div>
                        <div className="inline-actions">
                          <button
                            className="secondary"
                            disabled={pending || !version.parent_id}
                            onClick={() =>
                              run(async () =>
                                selectVersion(
                                  await api<Version>(
                                    "/versions/" + version.parent_id,
                                  ),
                                ),
                              )
                            }
                          >
                            <ArrowLeft size={15} />
                            {t("撤销", "Undo")}
                          </button>
                          <button
                            className="secondary"
                            disabled={
                              pending ||
                              version.id === version.original_version_id
                            }
                            onClick={() =>
                              run(async () =>
                                selectVersion(
                                  await api<Version>(
                                    "/versions/" + version.original_version_id,
                                  ),
                                ),
                              )
                            }
                          >
                            <RotateCcw size={15} />
                            {t("回到原始数据", "Reset to original")}
                          </button>
                          <button
                            className="secondary"
                            onClick={() => setCodeOpen(!codeOpen)}
                          >
                            <Code2 size={15} />
                            {t("Python 代码", "Python code")}
                          </button>
                        </div>
                      </div>
                      <div className="history-list">
                        {version.history.map((h, i) => (
                          <button
                            disabled={pending || h.id === version.id}
                            key={h.id}
                            className={
                              h.id === version.id
                                ? "history-step current"
                                : "history-step"
                            }
                            onClick={() =>
                              run(async () =>
                                selectVersion(
                                  await api<Version>("/versions/" + h.id),
                                ),
                              )
                            }
                          >
                            <span>{String(i + 1).padStart(2, "0")}</span>
                            <div>
                              <strong>{opName(h.operation)}</strong>
                              <small>
                                {h.rows} {t("行", "rows")} ·{" "}
                                {t("影响", "affected")} {h.affected_rows}
                              </small>
                            </div>
                            {h.id === version.id && <Check size={15} />}
                          </button>
                        ))}
                      </div>
                      {codeOpen && <pre className="code">{version.code}</pre>}
                    </section>
                  </>
                )}
                {tab === 2 && (
                  <>
                    <section className="panel compare-config">
                      <div className="panel-heading">
                        <div>
                          <h2>{t("对同一列，试两种处理方式", "Try two methods on the same column")}</h2>
                          <p>
                            {t(
                              "两个方案使用同一固定起点；比较只执行所选字段的缺失值处理。",
                              "Both scenarios start from the same fixed version and handle missing values in the selected field.",
                            )}
                          </p>
                        </div>
                        <GitBranch size={21} />
                      </div>
                      <div className="config-row">
                        {label(
                          "共同起点",
                          "Shared starting point",
                          <select
                            value={baseId}
                            onChange={(e) => {
                              const id = e.target.value;
                              setBaseId(id);
                              setCompare(null);
                              run(async () => {
                                const v = await api<Version>("/versions/" + id);
                                setCompareBase(v);
                                setCompareCol(
                                  v.columns.find((c) => c.kind === "numeric")
                                    ?.name || "",
                                );
                                setGroup("");
                              });
                            }}
                          >
                            {version.history.map((h, i) => (
                              <option key={h.id} value={h.id}>
                                {i + 1}. {opName(h.operation)}
                              </option>
                            ))}
                          </select>,
                        )}
                        {label(
                          "数值字段",
                          "Numeric field",
                          <select
                            value={compareCol}
                            onChange={(e) => {
                              setCompareCol(e.target.value);
                              setCompare(null);
                            }}
                          >
                            {comparisonOptions(true)}
                          </select>,
                        )}
                        {label(
                          "分组字段（可选）",
                          "Group field (optional)",
                          <select
                            value={group}
                            onChange={(e) => {
                              setGroup(e.target.value);
                              setCompare(null);
                            }}
                          >
                            <option value="">
                              {t("不分组", "No grouping")}
                            </option>
                            {comparisonOptions()}
                          </select>,
                        )}
                      </div>
                      <div className="scenario-grid">
                        {(["a", "b"] as const).map((key, i) => {
                          const m = i === 0 ? aMethod : bMethod,
                            sm = i === 0 ? setAMethod : setBMethod,
                            v = i === 0 ? aValue : bValue,
                            sv = i === 0 ? setAValue : setBValue;
                          return (
                            <div className={"scenario " + key} key={key}>
                              <span className="scenario-letter">
                                {key.toUpperCase()}
                              </span>
                              <div>
                                <h3>
                                  {t("方案", "Scenario")} {key.toUpperCase()}
                                </h3>
                                {label(
                                  "缺失值处理方式",
                                  "Missing-value method",
                                  <select
                                    value={m}
                                    onChange={(e) => {
                                      sm(e.target.value);
                                      setCompare(null);
                                    }}
                                  >
                                    {Object.entries(methodNames).map(
                                      ([x, n]) => (
                                        <option key={x} value={x}>
                                          {t(...n)}
                                        </option>
                                      ),
                                    )}
                                  </select>,
                                )}
                                {m === "constant" &&
                                  label(
                                    "填充值",
                                    "Fill value",
                                    <input
                                      value={v}
                                      onChange={(e) => {
                                        sv(e.target.value);
                                        setCompare(null);
                                      }}
                                    />,
                                  )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="panel-bottom">
                        <span className="hint">
                          {t(
                            "结果展示变化，由你判断哪种方案更合理。",
                            "The results explain the changes. You decide which choice fits.",
                          )}
                        </span>
                        <button
                          className="primary"
                          disabled={pending || !compareCol || !baseId}
                          onClick={() =>
                            run(async () => {
                              const make = (
                                m: string,
                                v: string,
                              ): Operation => ({
                                type: "fill_missing",
                                params: {
                                  column: compareCol,
                                  method: m,
                                  ...(m === "constant" ? { value: v } : {}),
                                },
                              });
                              setCompare(
                                await api<Comparison>("/compare", {
                                  version_id: baseId,
                                  column: compareCol,
                                  group_by: group || null,
                                  aggregate: "sum",
                                  a: make(aMethod, aValue),
                                  b: make(bMethod, bValue),
                                }),
                              );
                              await refreshDatasets();
                            })
                          }
                        >
                          <GitBranch size={16} />
                          {t("运行方案对比", "Run comparison")}
                        </button>
                      </div>
                    </section>
                    {!compare ? (
                      <div className="inline-empty">
                        <GitBranch size={32} />
                        <h3>
                          {t(
                            "不同的处理，会带来怎样的变化？",
                            "How will different choices change the result?",
                          )}
                        </h3>
                        <p>
                          {comparisonColumns.some((c) => c.kind === "numeric")
                            ? t(
                                "直接点击“运行方案对比”，即可看到删掉空值和填入中位数会怎样影响结果。也可以修改上方两种方法。",
                                "Click Run comparison to see how removing blanks and filling with the median affect your results, or choose two other methods above.",
                              )
                            : t(
                                "当前数据没有数值字段，请先转换字段类型。",
                                "No numeric fields available. Convert a field first.",
                              )}
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="next-action"><div>
                          <strong>{t("两种方法会保留多少数据？", "How much data does each method retain?")}</strong>
                          <p>{t(`起点有 ${compare.summary.base.rows} 行。方案 A 保留 ${compare.summary.a.rows} 行，这一列还剩 ${compare.summary.a.missing} 个空值；方案 B 保留 ${compare.summary.b.rows} 行，还剩 ${compare.summary.b.missing} 个空值。`, `Starting with ${compare.summary.base.rows} rows: A retains ${compare.summary.a.rows} rows with ${compare.summary.a.missing} blanks in this column; B retains ${compare.summary.b.rows} rows with ${compare.summary.b.missing} blanks.`)}</p>
                          <p>{t("再看看下方的平均值和总和。填进去的数值是估计值；是否采用，要结合数据本身判断。", "Compare the means and totals below. Filled values are estimates; choose a method that makes sense for your data.")}</p>
                        </div></div>
                        <section className="panel">
                          <div className="panel-heading">
                            <h2>{t("结果对照", "Results at a glance")}</h2>
                            <span className="badge">{compare.column}</span>
                          </div>
                          <div className="table-wrap">
                            <table className="comparison-table">
                              <thead>
                                <tr>
                                  <th>{t("指标", "Metric")}</th>
                                  <th>{t("共同起点", "Original")}</th>
                                  <th>{t("方案 A", "Scenario A")}</th>
                                  <th>{t("方案 B", "Scenario B")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(
                                  [
                                    "rows",
                                    "non_null",
                                    "missing",
                                    "retention",
                                    "mean",
                                    "median",
                                    "sum",
                                  ] as const
                                ).map((key, i) => (
                                  <tr key={key}>
                                    <td>
                                      {t(
                                        [
                                          "保留记录",
                                          "非空样本数",
                                          "缺失记录",
                                          "保留比例",
                                          "均值",
                                          "中位数",
                                          "总和",
                                        ][i],
                                        [
                                          "Rows retained",
                                          "Non-null samples",
                                          "Missing values",
                                          "Retention",
                                          "Mean",
                                          "Median",
                                          "Sum",
                                        ][i],
                                      )}
                                    </td>
                                    {(["base", "a", "b"] as const).map((k) => (
                                      <td key={k}>
                                        {compare.summary[k][key] === null
                                          ? "—"
                                          : key === "retention"
                                            ? `${compare.summary[k][key].toFixed(1)}%`
                                            : Number(
                                                compare.summary[k][key].toFixed(
                                                  2,
                                                ),
                                              ).toLocaleString()}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div className="compare-actions">
                            {(["a", "b"] as const).map((k) => (
                              <div key={k}>
                                <button
                                  className="secondary"
                                  disabled={pending}
                                  onClick={() =>
                                    run(async () =>
                                      setInspection(
                                        await api<Version>(
                                          `/versions/${compare[k].id}?affected_only=true&page_size=12`,
                                        ),
                                      ),
                                    )
                                  }
                                >
                                  <Search size={15} />
                                  {t("检查", "Inspect")} {k.toUpperCase()} ·{" "}
                                  {compare[k].affected_rows}{" "}
                                  {t("条影响记录", "affected")}
                                </button>
                                <button
                                  className="primary"
                                  disabled={pending}
                                  onClick={() => {
                                    selectVersion(compare[k]);
                                    setTab(1);
                                  }}
                                >
                                  {t("采用方案", "Adopt scenario")}{" "}
                                  {k.toUpperCase()}
                                  <Check size={15} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </section>
                        <section className="panel">
                          <div className="panel-heading">
                            <div>
                              <h2>
                                {t(
                                  "数值分布如何变化",
                                  "How the distribution changes",
                                )}
                              </h2>
                              <p>
                                {t(
                                  "共同分箱 · 非空样本的百分比 · 各系列使用同一坐标轴",
                                  "Shared bins · percentage of non-null samples · shared axes",
                                )}
                              </p>
                            </div>
                          </div>
                          <Plot
                            label={t(
                              "原始数据与方案 A、B 的数值分布，按各自非空样本归一化。",
                              "Distribution of the original and scenarios A and B, normalized by non-null samples.",
                            )}
                            option={categorical(
                              compare.distribution.labels,
                              (["base", "a", "b"] as const).map((k, i) => ({
                                name: [t("共同起点", "Original"), "A", "B"][i],
                                data: compare.distribution[k],
                              })),
                              "bar",
                              true,
                            )}
                          />
                        </section>
                        {compare.groups.labels.length > 0 && (
                          <section className="panel">
                            <div className="panel-heading">
                              <div>
                                <h2>{t("分组统计变化", "Changes by group")}</h2>
                                <p>
                                  {t(
                                    "求和 · 类别对齐 · 全空组显示为空",
                                    "Sum · aligned categories · all-missing groups remain null",
                                  )}
                                </p>
                              </div>
                            </div>
                            <Plot
                              label={t(
                                "原始数据与方案 A、B 的分组求和对比。",
                                "Grouped sums for the original and scenarios A and B.",
                              )}
                              option={categorical(
                                compare.groups.labels,
                                (["base", "a", "b"] as const).map((k, i) => ({
                                  name: [t("共同起点", "Original"), "A", "B"][
                                    i
                                  ],
                                  data: compare.groups[k],
                                })),
                              )}
                            />
                          </section>
                        )}
                      </>
                    )}
                  </>
                )}
                {tab === 3 && (
                  <>
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>{t("你想比较什么？", "What would you like to compare?")}</h2>
                          <p>
                            {t(
                              "柱状图适合比较大小，折线图适合看变化，散点图看两个数值的关系，直方图看数值分布。",
                              "Use bars to compare values, lines to see changes, scatter plots for relationships, or a histogram for a distribution.",
                            )}
                          </p>
                        </div>
                        <BarChart3 size={20} />
                      </div>
                      <div className="chart-controls">
                        {label(
                          "图表类型",
                          "Chart type",
                          <select
                            value={chartType}
                            onChange={(e) => {
                              setChartType(e.target.value);
                              setChart(null);
                            }}
                          >
                            {["bar", "line", "scatter", "histogram"].map(
                              (x, i) => (
                                <option key={x} value={x}>
                                  {t(
                                    ["柱状图", "折线图", "散点图", "直方图"][i],
                                    ["Bar", "Line", "Scatter", "Histogram"][i],
                                  )}
                                </option>
                              ),
                            )}
                          </select>,
                        )}
                        {label(
                          "横轴 / 分布字段",
                          "X / distribution field",
                          <select
                            value={chartX}
                            onChange={(e) => {
                              setChartX(e.target.value);
                              setChart(null);
                            }}
                          >
                            {fieldOptions(
                              chartType === "scatter" ||
                                chartType === "histogram",
                            )}
                          </select>,
                        )}
                        {chartType !== "histogram" &&
                          label(
                            "纵轴字段",
                            "Y field",
                            <select
                              value={chartY}
                              onChange={(e) => {
                                setChartY(e.target.value);
                                setChart(null);
                              }}
                            >
                              <option value="">
                                {t("记录数量", "Row count")}
                              </option>
                              {fieldOptions(chartType === "scatter")}
                            </select>,
                          )}
                        {chartType === "histogram"
                          ? label(
                              "分箱数量",
                              "Bins",
                              <input
                                type="number"
                                min="2"
                                max="50"
                                value={bins}
                                onChange={(e) => {
                                  setBins(Number(e.target.value));
                                  setChart(null);
                                }}
                              />,
                            )
                          : chartType !== "scatter" &&
                            label(
                              "聚合方式",
                              "Aggregation",
                              <select
                                value={chartAgg}
                                onChange={(e) => {
                                  setChartAgg(e.target.value);
                                  setChart(null);
                                }}
                              >
                                {["sum", "mean", "median", "count"].map(
                                  (x, i) => (
                                    <option key={x} value={x}>
                                      {t(
                                        ["求和", "均值", "中位数", "计数"][i],
                                        ["Sum", "Mean", "Median", "Count"][i],
                                      )}
                                    </option>
                                  ),
                                )}
                              </select>,
                            )}
                        <button
                          className="primary"
                          disabled={pending || !chartX}
                          onClick={() =>
                            run(async () =>
                              setChart(
                                await api<ChartData>(
                                  `/versions/${version.id}/chart`,
                                  {
                                    type: chartType,
                                    x: chartX,
                                    y: chartY || null,
                                    aggregate: chartAgg,
                                    bins,
                                  },
                                ),
                              ),
                            )
                          }
                        >
                          <BarChart3 size={16} />
                          {t("生成图表", "Generate chart")}
                        </button>
                      </div>
                      {chart ? (
                        <>
                          <div className="chart-title">
                            <strong>
                              {chart.y_label === "count"
                                ? t("数量", "Count")
                                : chart.y_label}{" "}
                              {chart.type === "histogram"
                                ? ""
                                : `/ ${chart.x_label}`}
                            </strong>
                            <span>
                              {chart.total_points.toLocaleString()}{" "}
                              {t("个数据点", "data points")}
                              {chart.sampled &&
                                ` · ${t("已抽样显示", "sampled for display")}`}
                            </span>
                          </div>
                          <Plot
                            label={`${chart.x_label} / ${chart.y_label === "count" ? t("数量", "Count") : chart.y_label} · ${chart.total_points} ${t("个数据点", "data points")}`}
                            option={
                              chart.type === "scatter"
                                ? {
                                    color: ["#168468"],
                                    tooltip: { trigger: "item" },
                                    grid: {
                                      left: 70,
                                      right: 30,
                                      top: 20,
                                      bottom: 55,
                                    },
                                    xAxis: {
                                      type: "value",
                                      name: chart.x_label,
                                      nameLocation: "middle",
                                      nameGap: 30,
                                    },
                                    yAxis: {
                                      type: "value",
                                      name: chart.y_label,
                                    },
                                    series: [
                                      {
                                        type: "scatter",
                                        data: chart.points,
                                        symbolSize: 8,
                                        itemStyle: { opacity: 0.6 },
                                      },
                                    ],
                                  }
                                : categorical(
                                    chart.labels,
                                    chart.series.map((s) => ({
                                      ...s,
                                      name:
                                        s.name === "count"
                                          ? t("数量", "Count")
                                          : s.name,
                                    })),
                                    chart.type === "line" ? "line" : "bar",
                                  )
                            }
                          />
                        </>
                      ) : (
                        <div className="inline-empty">
                          <BarChart3 size={35} />
                          <h3>
                            {t(
                              "选择字段，发现新的视角。",
                              "Choose fields. Discover a new perspective.",
                            )}
                          </h3>
                          <p>
                            {t(
                              "配置图表后点击生成，所有统计均在后端执行。",
                              "Configure and generate a chart. All statistics run on the backend.",
                            )}
                          </p>
                        </div>
                      )}
                    </section>
                    <section className="panel">
                      <div className="panel-heading">
                        <div>
                          <h2>
                            {t("带走你的分析成果", "Take your work with you")}
                          </h2>
                          <p>
                            {t(
                              "结果、原始数据与步骤一起导出，让分析可以复现。",
                              "Export results, source data and steps to reproduce your analysis.",
                            )}
                          </p>
                        </div>
                        <ArrowDownToLine size={21} />
                      </div>
                      <div className="export-grid">
                        {[
                          [
                            "export.csv",
                            t("处理后的数据", "Processed data"),
                            t(
                              "UTF-8 BOM CSV · 不含内部记录 ID",
                              "UTF-8 BOM CSV · no internal row IDs",
                            ),
                            FileSpreadsheet,
                          ],
                          [
                            "export.py",
                            t("可复现 Python", "Reproducible Python"),
                            t(
                              "完整 pandas 步骤 · 与实际执行一致",
                              "Complete pandas steps matching execution",
                            ),
                            Code2,
                          ],
                          [
                            "recipe.json",
                            t("操作配方", "Operation recipe"),
                            t(
                              "结构化 JSON · 记录操作与参数",
                              "Structured JSON · operations and parameters",
                            ),
                            GitBranch,
                          ],
                          [
                            "original.csv",
                            t("原始数据", "Original data"),
                            t(
                              "保留导入数据，支持脚本复现",
                              "Imported source for reproducibility",
                            ),
                            Database,
                          ],
                        ].map(([path, name, desc, Icon]) => {
                          const I = Icon as typeof Database;
                          return (
                            <a
                              className="export-card"
                              key={path as string}
                              href={`/api/versions/${version.id}/${path}`}
                              download
                            >
                              <I size={25} />
                              <strong>{name as string}</strong>
                              <p>{desc as string}</p>
                              <span>
                                {t("下载", "Download")}
                                <ArrowDownToLine size={14} />
                              </span>
                            </a>
                          );
                        })}
                      </div>
                      <div className="panel-bottom">
                        <span className="hint">
                          {t(
                            "上传数据的脚本读取 original.csv；请将两者放在同一目录。",
                            "For uploaded data, place the Python script beside original.csv.",
                          )}
                        </span>
                        <button
                          className="secondary"
                          disabled={!chart}
                          onClick={downloadConfig}
                        >
                          <ArrowDownToLine size={15} />
                          {t("导出图表配置", "Export chart config")}
                        </button>
                      </div>
                    </section>
                    <details className="panel field-details">
                      <summary>{t("查看对应的 pandas 代码（进阶）", "View the pandas code (advanced)")}</summary>
                      <pre className="code">{version.code}</pre>
                    </details>
                  </>
                )}
              </>
            )}
            <footer className="footer">
              <span>
                Pandas Lab <span> / </span>
                {t(
                  "让分析过程与结果同样清晰",
                  "Clarity in both process and result",
                )}
              </span>
              <span>
                {t(
                  "本地运行 · 数据留在你的设备上",
                  "Runs locally · your data stays on this device",
                )}
              </span>
            </footer>
          </fieldset>
        </main>
      </div>
      {inspection && (
        <div className="modal-backdrop" onClick={() => setInspection(null)}>
          <section
            className="modal panel"
            role="dialog"
            aria-modal="true"
            aria-label={t("影响记录", "Affected records")}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-heading">
              <div>
                <h2>{t("受影响的记录", "Affected records")}</h2>
                <p>
                  {opName(inspection.operation)} ·{" "}
                  {inspection.total_preview_rows} {t("行", "rows")}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label={t("关闭", "Close")}
                onClick={() => setInspection(null)}
              >
                <X size={20} />
              </button>
            </div>
            {dataTable(inspection)}
            <div className="inspection-pager">
              <button
                className="secondary"
                disabled={pending || inspection.page <= 1}
                onClick={() =>
                  run(async () =>
                    setInspection(
                      await api<Version>(
                        `/versions/${inspection.id}?affected_only=true&page_size=12&page=${inspection.page - 1}`,
                      ),
                    ),
                  )
                }
              >
                <ArrowLeft size={14} />
                {t("上一页", "Previous")}
              </button>
              <span>
                {inspection.page} /{" "}
                {Math.max(
                  1,
                  Math.ceil(
                    inspection.total_preview_rows / inspection.page_size,
                  ),
                )}
              </span>
              <button
                className="secondary"
                disabled={
                  pending ||
                  inspection.page * inspection.page_size >=
                    inspection.total_preview_rows
                }
                onClick={() =>
                  run(async () =>
                    setInspection(
                      await api<Version>(
                        `/versions/${inspection.id}?affected_only=true&page_size=12&page=${inspection.page + 1}`,
                      ),
                    ),
                  )
                }
              >
                {t("下一页", "Next")}
                <ArrowRight size={14} />
              </button>
            </div>
            <div className="panel-bottom">
              <span className="hint">
                {t(
                  "黄色为删除记录，绿色为修改记录；可翻页检查所有影响记录。",
                  "Amber rows were removed, green rows changed. Use pagination to inspect all affected rows.",
                )}
              </span>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
