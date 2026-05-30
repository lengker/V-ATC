// A1 实时采集已迁移至 Python（写入 LNG_TRACKS 并同步 A5）：
//   cd 联调
//   python a1_live_collector.py
//
// 全链路启动：联调\start-all.ps1（会自动打开采集器窗口）
// 地图数据：前端每 10s 从 A5 刷新；采集器每 10s 从 OpenSky 拉取香港附近航班。

console.info(
  "[A1] 请使用 联调/a1_live_collector.py 进行实时 ADS-B 采集（本页 JS 已停用）。"
);
console.info("[A1] 启动: python 联调/a1_live_collector.py");
