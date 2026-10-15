"""Deterministic teaching data, deliberately synthetic, never real campus readings."""
from pathlib import Path
import json
import numpy as np
import pandas as pd

PACK_VERSION = 'campus-v2'
LABELS = {
    'energy_2025': ['2025 能耗原始表', '2025 energy · raw'],
    'buildings': ['楼宇信息表', 'Building directory'],
    'energy_2026': ['2026 能耗追加表', '2026 energy · append'],
    'reference': ['已处理的参考结果', 'Prepared reference'],
    'monthly': ['月度汇总参考', 'Monthly reference'],
}
FIELDS = {
    'building_id': ['楼宇编号', 'Building ID', ''],
    'date': ['月份', 'Month', 'YYYY-MM-DD'],
    'electricity_kwh': ['用电量', 'Electricity', 'kWh'],
    'water_m3': ['用水量', 'Water', 'm³'],
    'temperature_c': ['平均气温', 'Temperature', '°C'],
    'occupancy_pct': ['使用率', 'Occupancy', '%'],
    'meter_status': ['电表状态', 'Meter status', ''],
    'building_name': ['楼宇名称', 'Building name', ''],
    'building_type': ['楼宇类型', 'Building type', ''],
    'zone': ['校区', 'Zone', ''],
    'area_m2': ['建筑面积', 'Floor area', 'm²'],
    'capacity': ['使用人数', 'Occupants', '人 / people'],
    'energy_per_m2': ['单位面积能耗', 'Energy per area', 'kWh/m²'],
    'energy_per_person': ['人均能耗', 'Energy per person', 'kWh/person'],
}

def make_pack():
    buildings = pd.DataFrame([
        ['B01', 'Library', 'Library', 'North', 8200, 600],
        ['B02', 'Teaching A', 'Teaching', 'North', 13500, 1600],
        ['B03', 'Lab A', 'Laboratory', 'North', 9700, 450],
        ['B04', 'Dorm A', 'Dormitory', 'South', 18000, 2200],
        ['B05', 'Teaching B', 'Teaching', 'South', 11200, 1250],
        ['B06', 'Lab B', 'Laboratory', 'East', 7600, 380],
        ['B07', 'Dorm B', 'Dormitory', 'East', 15600, 1850],
        ['B08', 'Sports Center', 'Sports', 'South', 12500, 800],
    ], columns=['building_id', 'building_name', 'building_type', 'zone', 'area_m2', 'capacity'])
    rng = np.random.default_rng(20251015)
    tables = {}
    for year in [2025, 2026]:
        rows = []
        for month in range(1, 13):
            temp = [3, 5, 11, 17, 23, 28, 32, 31, 25, 18, 11, 5][month-1]
            for idx, b in buildings.iterrows():
                rate = [2.2, 1.7, 4.1, 2.4, 1.8, 4.3, 2.3, 1.5][idx]
                seasonal = 1 + abs(temp-18)*0.018
                electricity = round(b.area_m2*rate*seasonal*(1+rng.normal(0, .07))*(.96 if year == 2026 else 1), 2)
                rows.append([b.building_id, f'{year}-{month:02d}-01', electricity,
                             round(b.capacity*.9*(1+rng.normal(0,.08)),2),
                             round(temp+rng.normal(0,.6),1), round(rng.uniform(62,95),1), 'normal'])
        tables[f'energy_{year}'] = pd.DataFrame(rows, columns=['building_id','date','electricity_kwh','water_m3','temperature_c','occupancy_pct','meter_status'])
    raw = tables['energy_2025']
    raw.loc[[2, 15, 28, 44, 60, 79], 'electricity_kwh'] = np.nan
    raw.loc[[5, 19, 51, 81], 'water_m3'] = np.nan
    raw.loc[[10, 56], 'temperature_c'] = np.nan
    raw.loc[[9, 33, 70], 'occupancy_pct'] = np.nan
    raw.loc[[4, 17, 22], 'meter_status'] = ' normal '
    raw.loc[42, 'electricity_kwh'] *= 3.5
    raw.loc[42, 'meter_status'] = 'review'
    tables['energy_2025'] = pd.concat([raw, raw.iloc[[0, 8, 24]]], ignore_index=True)
    tables['buildings'] = buildings
    reference = raw.copy()
    for c in ['electricity_kwh','water_m3','temperature_c','occupancy_pct']:
        reference[c] = reference[c].fillna(reference[c].median())
    reference['meter_status'] = reference.meter_status.str.strip()
    reference = reference.merge(buildings, on='building_id', validate='many_to_one')
    reference['energy_per_m2'] = reference.electricity_kwh/reference.area_m2
    reference['energy_per_person'] = reference.electricity_kwh/reference.capacity
    tables['reference'] = reference
    tables['monthly'] = reference.groupby('date', as_index=False)[['electricity_kwh','water_m3']].sum(min_count=1)
    return {k: tables[k] for k in LABELS}

def write_pack(directory: Path):
    directory.mkdir(parents=True, exist_ok=True)
    tables = make_pack()
    for key, df in tables.items():
        df.to_csv(directory/f'{key}.csv', index=False, encoding='utf-8-sig')
        (directory/f'{key}.json').write_text(df.to_json(orient='records', force_ascii=False, indent=2), encoding='utf-8')
    manifest = {'version': PACK_VERSION, 'synthetic': True, 'fields': FIELDS,
        'tables': [{'key': k, 'labels': LABELS[k], 'rows': len(v), 'columns': list(v.columns)} for k,v in tables.items()],
        'checks': {'raw_rows':99, 'deduplicated_rows':96, 'duplicates':3, 'missing_cells':15,
                   'building_keys':8, 'reference_rows':96, 'reference_missing':0,
                   'reference_electricity_sum':float(tables['reference'].electricity_kwh.sum())}}
    (directory/'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2),encoding='utf-8')
    return manifest
