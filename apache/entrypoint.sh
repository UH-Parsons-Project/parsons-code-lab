#!/bin/sh
set -eu

mkdir -p /var/cache/shibboleth /var/log/shibboleth /var/run/shibboleth

shibd -f -w 1 &
shibd_pid=$!

cleanup() {
    kill "$shibd_pid" 2>/dev/null || true
}

trap cleanup INT TERM EXIT

exec apachectl -D FOREGROUND