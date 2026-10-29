def test_registration_authenticates_and_account_can_log_in(client):
    response = client.post(
        "/api/v1/auth/register",
        json={"name": "  Asha   Rao ", "email": "Asha.Rao@example.com", "password": "secure-pass-8"},
    )

    assert response.status_code == 200
    registered = response.json()
    assert registered["token_type"] == "bearer"
    assert registered["user"] == {
        "id": registered["user"]["id"],
        "name": "Asha Rao",
        "email": "asha.rao@example.com",
        "role": "advocate",
        "avatar_initials": "AR",
        "title": "Advocate",
    }
    authenticated = client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {registered['access_token']}"}
    )
    assert authenticated.status_code == 200
    assert authenticated.json()["email"] == "asha.rao@example.com"

    login = client.post(
        "/api/v1/auth/login", json={"email": "ASHA.RAO@example.com", "password": "secure-pass-8"}
    )
    assert login.status_code == 200
    assert login.json()["user"]["id"] == registered["user"]["id"]

    cases = client.get(
        "/api/v1/cases", headers={"Authorization": f"Bearer {registered['access_token']}"}
    )
    assert cases.status_code == 200
    assert cases.json()["items"] == []


def test_registration_ignores_role_escalation(client):
    response = client.post(
        "/api/v1/auth/register",
        json={"name": "Mira Sen", "email": "mira@example.com", "password": "secure-pass-8", "role": "admin"},
    )

    assert response.status_code == 200
    assert response.json()["user"]["role"] == "advocate"


def test_registration_rejects_duplicate_email(client):
    body = {"name": "Mira Sen", "email": "mira@example.com", "password": "secure-pass-8"}
    assert client.post("/api/v1/auth/register", json=body).status_code == 200
    duplicate = client.post("/api/v1/auth/register", json={**body, "email": "MIRA@example.com"})

    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "duplicate"
    assert duplicate.json()["error"]["message"] == "An account with this email already exists"


def test_registration_validates_password_and_email(client):
    base = {"name": "Mira Sen", "email": "mira@example.com", "password": "secure-pass-8"}
    short_password = client.post("/api/v1/auth/register", json={**base, "password": "short"})
    malformed_email = client.post("/api/v1/auth/register", json={**base, "email": "not-an-email"})

    assert short_password.status_code == 422
    assert malformed_email.status_code == 422
