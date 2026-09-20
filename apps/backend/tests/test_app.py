from fastapi.testclient import TestClient

from yomi.app.main import create_app


def test_health_ok():
    with TestClient(create_app()) as client:
        resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["version"] == "0.1.0"


def test_robots_txt():
    with TestClient(create_app()) as client:
        resp = client.get("/robots.txt")
    assert resp.status_code == 200
    assert "User-agent" in resp.text


def test_unknown_route_404():
    with TestClient(create_app()) as client:
        resp = client.get("/no-such-route")
    assert resp.status_code == 404