校园能耗教学数据包 / Campus energy teaching data

来源 / Source
全部为教学模拟数据，固定随机种子 20251015，不是真实校园记录。
All records are synthetic teaching data, generated with seed 20251015. They are not real campus readings.
2025 与 2026 全年的数值均为模拟值；不代表已经发生的实际观测。
All months in 2025 and 2026 are simulated, not actual observations.

文件 / Files
energy_2025.csv / .json: 99 行、7 列；8 栋楼 × 12 个月，另有 3 条重复行。
99 rows, 7 columns; 8 buildings × 12 months plus 3 duplicate rows.
buildings.csv / .json: 8 行；building_id 唯一，支持多对一关联。
8 rows; unique building_id supports a many-to-one join.
energy_2026.csv / .json: 96 行；与 2025 原始表同结构，供追加使用。
96 rows; same schema as the 2025 source for appending.
reference.csv / .json: 96 行；已处理明细，包含楼宇资料与两项计算指标。
96 prepared rows with building attributes and two energy-intensity calculations.
monthly.csv / .json: 12 行；参考结果的月度用电量、用水量汇总。
12 rows of monthly electricity and water totals from the reference table.
campus-data.xlsx: 包含以上五表及中英说明；数据表第一行均为字段名。
Contains all five tables and a bilingual Readme. Data sheets have headers in row 1.

单位 / Units
electricity_kwh: kWh; water_m3: m³; temperature_c: °C; occupancy_pct: 0–100%;
area_m2: m²; capacity: 人 / people; energy_per_m2: kWh/m²; energy_per_person: kWh/person.
date 为每月第一天，代表该月汇总记录。人数和面积为楼宇固定属性。
date is the first day of the month and represents that month's record. Area and occupants are fixed building attributes.

已知的数据质量问题 / Known quality issues
原始表有 3 条整行重复，15 个空值（用电量 6，用水量 4，气温 2，使用率 3）。
3 repeated rows and 15 blanks: electricity 6, water 4, temperature 2, occupancy 3.
meter_status 有 3 个带首尾空格的值。
3 meter_status values have leading/trailing spaces.
B03 / 2025-06-01 用电量刻意放大 3.5 倍，meter_status 为 review。
B03 / 2025-06-01 electricity is multiplied by 3.5 and flagged review.
这是一条需要检查的高值，不应自动当作错误；参考结果保留此值。
This high value warrants inspection, not automatic deletion; it is retained in the reference.

参考处理流程 / Reference workflow
1. 整行去重，保留首次记录：99 → 96 行。
   Remove whole-row duplicates, keep first: 99 → 96 rows.
2. 对 electricity_kwh、water_m3、temperature_c、occupancy_pct 分别以该列全表中位数填补。
   Fill each of those numeric columns using its own global median.
3. 对 meter_status 去除首尾空格。
   Trim whitespace from meter_status.
4. 用 building_id 左连接 buildings，验证多对一。
   Left join buildings on building_id; validate many-to-one.
5. energy_per_m2 = electricity_kwh / area_m2。
   energy_per_person = electricity_kwh / capacity。
6. 按 date 分组，对 electricity_kwh 和 water_m3 求和。
   Group by date and sum electricity_kwh and water_m3 for monthly totals.
中位数填补是教学示范，不代表最佳处理策略。
Median imputation is a teaching example, not a claim of optimal treatment.

核对结果 / Verification
参考明细：96 行，0 个空值，总用电量 3,365,213.34 kWh。
Prepared detail: 96 rows, no blanks, total electricity 3,365,213.34 kWh.
按楼宇分组：8 行；按月份汇总：12 行；两种汇总的用电量总和均应相同。
Grouping by building yields 8 rows; by month yields 12. Electricity totals must agree.
2025 去重后的 96 行追加 2026 的 96 行，应为 192 行。
Appending deduplicated 2025 to 2026 gives 192 rows.
仅删除 electricity_kwh 空值会丢失 6 条记录（先去重的前提下）。
Dropping missing electricity removes 6 records after deduplication.

建议演示 / Suggested demonstration
打开 reference，选 building_name 为横轴、electricity_kwh 为纵轴，求和画柱状图。
Open reference, chart building_name on X and summed electricity_kwh on Y.
点击柱子检查其 12 条月份记录；打开统计页查看相关性，点击格子看散点图。
Click a bar to inspect its 12 monthly records. Open Statistics and click a correlation cell for its scatter plot.
再运行“完整分析演示”，从原始表复现上述参考结果。
Then run the guided analysis to reproduce the prepared reference from raw data.
