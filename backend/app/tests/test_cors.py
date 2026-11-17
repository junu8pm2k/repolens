from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _preflight(origin: str):
    return client.options(
        "/api/repos/connect",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )


def test_dev_cors_preflight_allows_local_and_lan_origins() -> None:
    for origin in (
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://192.168.10.1:3000",
        "http://172.20.10.2:3000",
        "http://my-laptop:3000",
    ):
        response = _preflight(origin)

        assert response.status_code == 200, (
            f"{origin}: {response.status_code} {response.text}"
        )
        assert response.headers.get("access-control-allow-origin") == origin


def test_dev_cors_preflight_rejects_public_origin() -> None:
    response = _preflight("https://attacker.example.com")

    assert response.status_code == 400
    assert "Disallowed CORS origin" in response.text
