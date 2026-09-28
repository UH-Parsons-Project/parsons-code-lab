Note that the files in the manifest folder do not automatically get applied to OpenShift. Insteand, you need to:

1. Login to OpenShift with the login token and command found in the web panel
2. Navigate to the relevant folder matching whether you are making changes to prod or staging, for example `manifest/staging/'
3. Apply any modifications made to the file (for example deployment.yaml) by running:

```bash
oc apply -f deployment.yaml
```

For production Redis caching, apply the Redis resources before restarting the
application deployment:

```bash
oc apply -f manifest/production/redis.yaml
oc apply -f manifest/production/deployment.yaml
```

The Redis service is internal to the OpenShift namespace and is not exposed
through a Route. It is an ephemeral cache, so no persistent volume is used.