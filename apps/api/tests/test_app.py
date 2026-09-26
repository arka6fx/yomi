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

def test_no_route_only_answers_on_a_trailing_slash():
    """A route registered only as ".../" makes "..." 307 to the slash form on
    api.getyomi.in, and the browser drops the Bearer token on that cross-origin hop
    (this hid everyone's routines from the dashboard). Register "" as the real
    route and keep any "/" twin out of the schema."""
    from yomi.app.main import app

    slash_paths = [p for p in app.openapi()["paths"] if p != "/" and p.endswith("/")]
    assert slash_paths == []


def test_schedules_answers_without_redirect():
    from fastapi.testclient import TestClient

    from yomi.app.main import app

    res = TestClient(app).get("/api/schedules", follow_redirects=False)
    assert res.status_code == 401  # asks for auth instead of redirecting
