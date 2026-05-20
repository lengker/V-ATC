from __future__ import annotations

import os

from locust import HttpUser, between, task


class LongStabilityUser(HttpUser):
    wait_time = between(5, 10)
    enable_historical = os.getenv("A2_LOCUST_ENABLE_HISTORICAL", "0") == "1"

    @task(8)
    def scheduler_status(self):
        self.client.get("/api/v1/ingestion/scheduler/status", name="long_status")

    @task(2)
    def trigger_realtime(self):
        self.client.post("/api/v1/ingestion/scheduler/trigger/realtime", name="long_realtime")

    @task(1)
    def trigger_historical(self):
        if not self.enable_historical:
            return
        self.client.post("/api/v1/ingestion/scheduler/trigger/historical", name="long_historical")
