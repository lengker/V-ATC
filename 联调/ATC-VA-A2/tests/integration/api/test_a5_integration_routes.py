"""A-5 integration route tests."""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_get_track_metadata(client):
    resp = await client.get("/api/v1/tracks/123/metadata")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["track_id"] == 123


@pytest.mark.asyncio
async def test_get_user_metadata(client):
    resp = await client.get("/api/v1/users/55/metadata")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["author_id"] == 55


@pytest.mark.asyncio
async def test_list_audio_by_track(client, seeded_a5_audio):
    resp = await client.get("/api/v1/audio/by-track/9001", params={"limit": 5})
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["track_id"] == 9001
    assert payload["file_count"] == 1


@pytest.mark.asyncio
async def test_list_audio_by_annotator(client, seeded_a5_audio):
    resp = await client.get("/api/v1/audio/by-annotator/42", params={"limit": 5})
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["author_id"] == 42
    assert payload["annotation_count"] == 1


@pytest.mark.asyncio
async def test_sync_annotations_to_a5_requires_token(client, voice_file_id):
    resp = await client.post(f"/api/v1/a5/sync-annotations-to-a5/{voice_file_id}")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_sync_annotations_to_a5_success(client, voice_file_id, api_token_headers):
    resp = await client.post(
        f"/api/v1/a5/sync-annotations-to-a5/{voice_file_id}",
        headers=api_token_headers,
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["voice_file_id"] == voice_file_id


@pytest.mark.asyncio
async def test_sync_annotations_from_a5_requires_token(client, voice_file_id):
    resp = await client.post(
        f"/api/v1/a5/sync-annotations-from-a5/{voice_file_id}",
        json={"voice_file_id": voice_file_id, "annotations": []},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_sync_annotations_from_a5_success(client, voice_file_id, api_token_headers):
    resp = await client.post(
        f"/api/v1/a5/sync-annotations-from-a5/{voice_file_id}",
        json={"voice_file_id": voice_file_id, "annotations": []},
        headers=api_token_headers,
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["voice_file_id"] == voice_file_id


@pytest.mark.asyncio
async def test_cross_module_report(client, seeded_a5_audio):
    resp = await client.get(
        "/api/v1/a5/cross-module-report",
        params={
            "start_time": "2024-01-01T00:00:00",
            "end_time": "2024-01-01T03:00:00",
        },
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert "annotation_rate" in payload
