"""Shibboleth service-provider helpers for optional HY teacher login."""

from urllib.parse import quote

from fastapi import HTTPException, Request, status

from . import config


def shibboleth_login_url(target: str = "/auth/saml/login") -> str:
    return f"/Shibboleth.sso/Login?target={quote(target, safe='/')}"


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