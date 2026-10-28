from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.main import app


def _assert_error_envelope(response, status_code, code):
    assert response.status_code == status_code
    body = response.json()
    assert set(body) == {"error"}
    assert set(body["error"]) >= {"code", "message"}
    assert body["error"]["code"] == code
    assert "detail" not in body


def test_unmatched_and_wrong_method_routes_use_api_error_envelopes(client):
    not_found = client.get("/api/v1/this-route-does-not-exist")
    _assert_error_envelope(not_found, 404, "not_found")

    wrong_method = client.post("/api/v1/health")
    _assert_error_envelope(wrong_method, 405, "request_error")


def test_malformed_request_body_uses_validation_error_envelope(client):
    response = client.post(
        "/api/v1/auth/login",
        content="{malformed-json",
        headers={"Content-Type": "application/json"},
    )
    _assert_error_envelope(response, 422, "validation_error")
    assert "details" in response.json()["error"]


def test_unexpected_exception_returns_sanitized_internal_error_envelope(client):
    def controlled_failure():
        raise RuntimeError("private database connection detail")

    route = APIRoute("/api/v1/_test-controlled-failure", controlled_failure, methods=["GET"])
    app.router.routes.append(route)
    try:
        response = TestClient(app, raise_server_exceptions=False).get("/api/v1/_test-controlled-failure")
    finally:
        app.router.routes.remove(route)

    _assert_error_envelope(response, 500, "internal_error")
    assert response.json()["error"]["message"] == "Internal server error"
    assert "private database connection detail" not in response.text
