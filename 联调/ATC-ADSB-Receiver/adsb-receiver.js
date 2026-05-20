// @ts-nocheck
class ADSBDataReceiver {
  constructor() {
    this.dataList = [];
    // 你的数据库API地址
    this.API_BASE = "http://127.0.0.1:8000";
  }

  // 调用你的 /query 接口
  async runSQL(sql, params = []) {
    try {
      const res = await fetch(`${this.API_BASE}/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ sql, params })
      });

      if (!res.ok) {
        console.error("❌ API请求失败，状态码：", res.status);
        return null;
      }

      return await res.json();
    } catch (err) {
      console.error("❌ 连接数据库API失败：", err.message);
      return null;
    }
  }

  // 初始化表（通过API）
  async initTable() {
    const sql = `
      CREATE TABLE IF NOT EXISTS aircraft_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        icao TEXT,
        callsign TEXT,
        latitude REAL,
        longitude REAL,
        altitude REAL,
        speed REAL,
        heading REAL,
        timestamp INTEGER
      );
    `;
    await this.runSQL(sql);
    console.log("✅ 数据表初始化完成（通过API）");
  }

  // 写入数据（通过API）
  async insertData(data) {
    const sql = `
      INSERT INTO aircraft_data
      (icao, callsign, latitude, longitude, altitude, speed, heading, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      data.icao,
      data.callsign,
      data.latitude,
      data.longitude,
      data.altitude,
      data.speed,
      data.heading,
      data.timestamp
    ];
    await this.runSQL(sql, params);
    console.log("✅ 数据已通过API写入：", data.icao);
  }
}

const receiver = new ADSBDataReceiver();

// 获取数据并写入
async function fetchAndSave() {
  console.log("正在采集航迹数据...");
  try {
    const res = await fetch("https://opensky-network.org/api/states/all");
    const data = await res.json();
    const states = data.states || [];
    console.log(`✅ 采集到 ${states.length} 架飞机`);

    for (const s of states) {
      const icao = s[0];
      const callsign = (s[1] || "").trim();
      const lat = s[6];
      const lon = s[5];
      const alt = s[7];
      const speed = s[9];
      const heading = s[10];

      if (lat && lon) {
        await receiver.insertData({
          icao,
          callsign,
          latitude: lat,
          longitude: lon,
          altitude: alt,
          speed,
          heading,
          timestamp: Date.now()
        });
      }
    }
  } catch (err) {
    console.error("❌ 拉取数据失败：", err.message);
  }
}

// 启动
(async () => {
  await receiver.initTable();
  console.log("🚀 开始自动写入数据库（通过API）...");
  setInterval(fetchAndSave, 15000);
  fetchAndSave();
})();