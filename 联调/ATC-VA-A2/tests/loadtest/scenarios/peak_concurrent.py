from __future__ import annotations

import os

from locust import HttpUser, constant_pacing, task


class PeakConcurrentUser(HttpUser):
    wait_time = constant_pacing(1)
    enable_historical = os.getenv("A2_LOCUST_ENABLE_HISTORICAL", "0") == "1"

    @task(5)
    def scheduler_status(self):
        self.client.get("/api/v1/ingestion/scheduler/status", name="peak_status")

    @task(3)
    def trigger_realtime(self):
        self.client.post("/api/v1/ingestion/scheduler/trigger/realtime", name="peak_realtime")

    @task(2)
    def trigger_historical(self):
        if not self.enable_historical:
            return
        self.client.post("/api/v1/ingestion/scheduler/trigger/historical", name="peak_historical")
