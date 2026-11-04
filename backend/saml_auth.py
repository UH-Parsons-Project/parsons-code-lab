"""Shibboleth service-provider helpers for optional HY teacher login."""

import time
from urllib.parse import quote

import jwt
from fastapi import HTTPException, Request, Response, status

from . import config
from .teacher_auth import ALGORITHM, SECRET_KEY

SAML_FLOW_COOKIE = "saml_flow"
SAML_LOGOUT_WINDOW_SECONDS = 2 * 60 * 60
SAML_REAUTH_AFTER_SECONDS = 60 * 60
SAML_FULL_LOGOUT_COUNT = 4


def shibboleth_login_url(
    target: str = "/auth/saml/login", *, force_authn: bool = False
) -> str:
    url = f"/Shibboleth.sso/Login?target={quote(target, safe='/')}"
    if force_authn:
        url += "&forceAuthn=true"
    return url

HY_IDP_LOGOUT_URL = "https://login.helsinki.fi/idp/profile/Logout"


def shibboleth_logout_url() -> str:
    """Initiate SAML logout, then continue to the HY IdP logout page."""
    return f"/Shibboleth.sso/Logout?return={quote(HY_IDP_LOGOUT_URL, safe='')}"


def shibboleth_local_logout_url() -> str:
    """End only the local Shibboleth session and return to the home page."""
    return "/Shibboleth.sso/Logout/Local?return=%2F"


SAML_AUTH_CLAIM = {"auth": "saml"}


def _read_saml_flow(request: Request) -> dict:
    token = request.cookies.get(SAML_FLOW_COOKIE)
    if not token:
        return {}
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.InvalidTokenError:
        return {}

    raw_times = payload.get("logout_times", [])
    if not isinstance(raw_times, list):
        raw_times = []
    logout_times = [
        value for value in raw_times
        if isinstance(value, int) and not isinstance(value, bool)
    ]
    last_logout = payload.get("last_logout")
    if not isinstance(last_logout, int) or isinstance(last_logout, bool):
        last_logout = None
    return {"logout_times": logout_times, "last_logout": last_logout}


def _write_saml_flow(
    response: Response, *, logout_times: list[int], last_logout: int | None
) -> None:
    now = int(time.time())
    expires_at = max(logout_times, default=now) + SAML_LOGOUT_WINDOW_SECONDS
    if expires_at <= now:
        response.delete_cookie(SAML_FLOW_COOKIE, path="/")
        return
    token = jwt.encode(
        {
            "logout_times": logout_times,
            "last_logout": last_logout,
            "exp": expires_at,
        },
        SECRET_KEY,
        algorithm=ALGORITHM,
    )
    response.set_cookie(
        key=SAML_FLOW_COOKIE,
        value=token,
        max_age=expires_at - now,
        path="/",
        httponly=True,
        secure=config.COOKIE_SECURE,
        samesite="lax",
    )


def saml_login_requires_authentication(request: Request) -> bool:
    last_logout = _read_saml_flow(request).get("last_logout")
    return bool(
        last_logout is not None
        and int(time.time()) - last_logout >= SAML_REAUTH_AFTER_SECONDS
    )


def record_saml_login(request: Request, response: Response) -> None:
    flow = _read_saml_flow(request)
    if flow:
        _write_saml_flow(
            response,
            logout_times=flow["logout_times"],
            last_logout=None,
        )


def record_saml_logout(request: Request, response: Response) -> str:
    now = int(time.time())
    flow = _read_saml_flow(request)
    logout_times = [
        timestamp
        for timestamp in flow.get("logout_times", [])
        if now - timestamp < SAML_LOGOUT_WINDOW_SECONDS
    ]
    logout_times.append(now)

    if len(logout_times) >= SAML_FULL_LOGOUT_COUNT:
        _write_saml_flow(response, logout_times=[], last_logout=now)
        return shibboleth_logout_url()

    _write_saml_flow(response, logout_times=logout_times, last_logout=now)
    return shibboleth_local_logout_url()


def _app_token_is_saml(request: Request) -> bool:
    token = request.cookies.get("access_token")
    if not token:
        return False
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.InvalidTokenError:
        return False
    return payload.get("auth") == SAML_AUTH_CLAIM["auth"]


def has_shibboleth_session(request: Request) -> bool:
    """Whether logout should also end the Shibboleth/HY session.

    Besides the proxy header, the app's own token records that the login came
    from SAML, so logout still reaches Shibboleth if the proxy does not forward
    Shib-Session-ID or the SP cookie to this route.
    """
    if not config.SAML_ENABLED:
        return False
    if request.headers.get("Shib-Session-ID"):
        return True
    return _app_token_is_saml(request)


def shibboleth_identity(request: Request) -> tuple[str, str] | None:
    """Return the authenticated identity supplied by Shibboleth."""
    if not any(request.headers.get(name) for name in (
        "Shib-Session-ID",
        "REMOTE_USER",
        "eppn",
    )):
        return None

    def first_attribute(*names: str) -> str:
        for name in names:
            value = request.headers.get(name)
            if value:
                return value.split(",", 1)[0].strip()
        return ""

    email = first_attribute(
        config.SAML_EMAIL_ATTRIBUTE,
        "mail",
        "email",
        "eppn",
        "REMOTE_USER",
    ).lower()
    username = first_attribute(
        config.SAML_USERNAME_ATTRIBUTE,
        "uid",
        "REMOTE_USER",
    )
    if not email or "@" not in email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Shibboleth response has no valid email",
        )
    username = (username or email.split("@", 1)[0]).strip()
    if "@" in username:
        username = username.split("@", 1)[0]
    return email, username


def require_saml() -> None:
    if not config.SAML_ENABLED:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)