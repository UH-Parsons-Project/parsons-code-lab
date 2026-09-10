# HY login through Shibboleth

Shibboleth is the SAML service provider for this application. It owns the
SAML endpoints and passes the authenticated identity to FastAPI. The
application does not create AuthnRequests or process SAML POST responses.

The Shibboleth SP must be installed in front of Uvicorn and protect the
application login route. It must forward these values as request headers:

- `Shib-Session-ID`
- `mail` (or the configured `SAML_EMAIL_ATTRIBUTE`)
- `uid` (or the configured `SAML_USERNAME_ATTRIBUTE`)

Only the trusted Shibboleth proxy may reach the application directly. The
proxy must remove client-supplied copies of these headers before adding its
own values.

## Register the SP

Production:

```text
Entity ID: https://parsonscodelab.web.helsinki.fi/sp
ACS:       https://parsonscodelab.web.helsinki.fi/Shibboleth.sso/SAML2/POST
Metadata:  https://parsonscodelab.web.helsinki.fi/Shibboleth.sso/Metadata
Logout:    https://parsonscodelab.web.helsinki.fi/Shibboleth.sso/Logout
```

Staging:

```text
Entity ID: https://faded-parsons-staging-timed-parsons.apps.ocp-test-0.k8s.it.helsinki.fi/sp
ACS:       https://faded-parsons-staging-timed-parsons.apps.ocp-test-0.k8s.it.helsinki.fi/Shibboleth.sso/SAML2/POST
Metadata:  https://faded-parsons-staging-timed-parsons.apps.ocp-test-0.k8s.it.helsinki.fi/Shibboleth.sso/Metadata
Logout:    https://faded-parsons-staging-timed-parsons.apps.ocp-test-0.k8s.it.helsinki.fi/Shibboleth.sso/Logout
```

Register the entity ID and the three Shibboleth endpoints with the HY/SP
registry. The metadata, ACS, and logout entries must be Shibboleth endpoint
types, not FastAPI routes. The Shibboleth configuration and its SP
certificate/private key are managed by the platform deployment, not by this
application container.

## Configure OpenShift

```bash
oc -n timed-parsons create secret generic saml-config-staging \
  --from-literal=SAML_ENABLED=true \
  --from-literal=SAML_TEST_PAGE_ENABLED=true \
  --from-literal=SAML_EMAIL_ATTRIBUTE=mail \
  --from-literal=SAML_USERNAME_ATTRIBUTE=uid
```

Create equivalent production Secrets with production URLs and names. Restart
the deployment after creating or changing a Secret:

```bash
oc -n timed-parsons rollout restart deployment/faded-parsons-staging
```

## Test

The unlinked test page is available only when both `SAML_ENABLED=true` and
`SAML_TEST_PAGE_ENABLED=true`:

```text
/internal/saml-test
```

It is not linked from the normal navigation and has `noindex` metadata. Open
the page, start HY login, and verify the redirect to `/teacher-dashboard`.
Before that, open `/Shibboleth.sso/Metadata` and verify that the XML contains
the registered SP entity ID and certificate.

The Shibboleth login integration is disabled unless `SAML_ENABLED=true`.

## Build the OpenShift proxy image

The Apache/Shibboleth proxy is built separately from the application image and
runs as a sidecar. Build and push it to the image registry used by the staging
Deployment:

```bash
docker build -f apache/Dockerfile \
  -t quay.io/tike/ohtu-faded-parsons-shibboleth:staging apache
docker push quay.io/tike/ohtu-faded-parsons-shibboleth:staging
```

The existing `cert-and-private-key` Secret is used for the Shibboleth SP
credentials. Its `shib.crt` and `shib.key` values are mounted as both the
signing and encryption credentials. Separate signing and encryption pairs are
recommended for a later hardening step.

```bash
oc -n timed-parsons create secret generic shibboleth-metadata-certificate \
  --from-file=sign-login.helsinki.fi-v2.pem=PATH_TO_HY_METADATA_SIGNING_CERTIFICATE
```

The private keys must never be committed or included in the Docker build
context. Apply the staging manifests only after the image and Secrets exist:

```bash
oc apply -f manifest/staging/deployment.yaml
oc apply -f manifest/staging/services.yaml
oc apply -f manifest/staging/routes.yaml
oc -n timed-parsons rollout status deployment/faded-parsons-staging
```

Check the proxy before testing login:

```bash
curl -fsS https://faded-parsons-staging-timed-parsons.apps.ocp-test-0.k8s.it.helsinki.fi/Shibboleth.sso/Metadata
```
