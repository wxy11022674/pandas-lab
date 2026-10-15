export type Operation = { type: string; params: Record<string, unknown> };
export type Column = {
  name: string;
  dtype: string;
  kind: string;
  missing: number;
  unique: number;
  stats: null | {
    min: number | null;
    max: number | null;
    mean: number | null;
    median: number | null;
  };
};
export type Version = {
  id: string;
  dataset_id: string;
  dataset_name: string;
  original_version_id: string;
  parent_id: string | null;
  operation: Operation | null;
  rows: number;
  columns: Column[];
  preview: Record<string, unknown>[];
  page: number;
  page_size: number;
  total_preview_rows: number;
  total_missing: number;
  duplicates: number;
  affected_rows: number;
  changed_ids: number[];
  removed_ids: number[];
  history: {
    id: string;
    parent_id: string | null;
    operation: Operation | null;
    rows: number;
    affected_rows: number;
  }[];
  code: string;
};
export type Dataset = {
  id: string;
  name: string;
  original_version_id: string;
  latest_version_id: string;
};
export type Metrics = {
  rows: number;
  non_null: number;
  missing: number;
  retention: number;
  mean: number | null;
  median: number | null;
  sum: number | null;
};
export type Comparison = {
  base: Version;
  a: Version;
  b: Version;
  column: string;
  distribution: { labels: string[]; base: number[]; a: number[]; b: number[] };
  groups: {
    labels: string[];
    base: (number | null)[];
    a: (number | null)[];
    b: (number | null)[];
  };
  summary: { base: Metrics; a: Metrics; b: Metrics };
};
export type ChartData = {
  type: string;
  x_label: string;
  y_label: string;
  labels: string[];
  series: { name: string; data: (number | null)[] }[];
  points: number[][];
  sampled: boolean;
  total_points: number;
};
