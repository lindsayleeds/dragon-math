# nginx — production config (mydragonmath.com)

> **Historical. Nothing here is running.** This describes the nginx that fronted
> the Linux boxes (`sondapor`, `camelot`), which were decommissioned on
> 2026-09-21 when both environments moved to Google Cloud Run. There is no nginx
> in the serving path any more, and the template this file used to point at
> (`deploy/nginx/site.conf.template`) was deleted with the pipeline —
> [deploy/README.md](../deploy/README.md) has that history.
>
> It is kept because several source comments cite it for the *reasons* behind
> choices that outlived the box: the asset cache headers, the `/api/`
> `proxy_read_timeout` that `server/lib/pgPool.js` matches its pool timeout to,
> and the ephemeral filesystem that makes runtime writes to `public/` useless.
> Those constraints still hold on Cloud Run; the mechanism described below does
> not. Read it for the why, never as the current config.

## Topology

- nginx terminates TLS (Certbot) and serves the site for
  `mydragonmath.com` / `www.mydragonmath.com`.
- Static frontend is the Vite build at
  `/home/azureuser/repos/dragon-math/dist` (`vite build` deploys it).
- The Express API runs under PM2 as `dragonmath-api` on `127.0.0.1:4070`
  (`pm2 reload dragonmath-api` to deploy server code).
- **The API binds loopback only.** It listens on `127.0.0.1` by default
  ([server/lib/bindHost.js](../server/lib/bindHost.js)), so the plaintext API is
  not reachable on the box's LAN or public interfaces and nginx's TLS
  termination can't be bypassed. `API_HOST` overrides the bind address for
  topologies where the proxy isn't on the same host (a container, say); leaving
  it unset is the right choice on this box, and setting `API_HOST=0.0.0.0` here
  would re-expose the API. The bind host is identical for every pm2 worker, so
  it works unchanged in cluster mode — the master owns the one bound socket and
  hands the shared handle to workers keyed on that host+port.
- `/api/` proxies to Express. There are no websocket endpoints — live PvP and its
  `/api/rt` socket were removed, so the proxy carries no upgrade headers.

## The `@ssr` fallback — why Express serves the SPA HTML

`location /` does **not** serve a static `index.html` directly. It falls back
to Express:

```nginx
location / {
    try_files $uri $uri/ @ssr;
}

location @ssr {
    proxy_pass http://127.0.0.1:4070;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Real files (assets, `manifest.webmanifest`, icons) are served by nginx via
`try_files $uri`. Anything else — SPA routes — falls through to Express, whose
final `app.use()` handler in [server/index.js](../server/index.js) returns
`dist/index.html`.

`/.well-known/apple-app-site-association` (iOS universal links) isn't a file
in `dist/` either, so it falls through to Express the same way, which serves
it as JSON from its own route. Don't add a `location` that redirects it: Apple
refuses the file behind a redirect.

**Why route SPA HTML through Express:** the kid "login by URL" feature needs a
**per-kid PWA manifest** baked into the server-rendered HTML. iOS Safari reads
`<link rel="manifest">` from the *initial HTML* at "Add to Home Screen" time
and ignores any client-side JS change to it. So for `/k/<token>` and
`?k=<token>` URLs, Express rewrites the manifest link to
`/api/manifest/k/<token>` (`start_url=/k/<token>`), making the home-screen icon
launch straight back into that kid's session instead of the parent/teacher
chooser. All other routes get the default `/manifest.webmanifest`
(`start_url=/`). See [server/routes/manifest.js](../server/routes/manifest.js).

> Note: Express 5 rejects the old `app.get('*')` wildcard route string. The
> SPA fallback is a path-less `app.use()` middleware for this reason.

## Full server block (HTTPS)

```nginx
server {
    server_name mydragonmath.com www.mydragonmath.com;

    root /home/azureuser/repos/dragon-math/dist;
    index index.html;

    # The websocket upgrade headers that used to be here went with live PvP.
    # The file on the box may still carry them until it is next reapplied; they
    # are inert now that nothing upgrades, so it is not urgent.
    location /api/ {
        proxy_pass http://127.0.0.1:4070;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    location = /index.html {
        add_header Cache-Control "no-cache, must-revalidate" always;
    }

    location = /version.json {
        add_header Cache-Control "no-cache, must-revalidate" always;
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable" always;
        try_files $uri =404;
    }

    location / {
        try_files $uri $uri/ @ssr;
    }

    location @ssr {
        proxy_pass http://127.0.0.1:4070;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    listen [::]:443 ssl; # managed by Certbot
    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/mydragonmath.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mydragonmath.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

# Port 80 -> 443 redirect (managed by Certbot)
server {
    if ($host = www.mydragonmath.com) { return 301 https://$host$request_uri; }
    if ($host = mydragonmath.com)     { return 301 https://$host$request_uri; }

    server_name mydragonmath.com www.mydragonmath.com;
    listen 80;
    listen [::]:80;
    return 404;
}
```

## Applying changes

Edit the template and deploy — there is no step to run on the box, and a
hand-edit there is reverted by the next release. `release.sh` installs the
rendered config, validates it, proves the reloaded config still serves, and puts
the previous one back if either check fails; the same run deploys the server and
the frontend bundle. See [deploy/README.md](../deploy/README.md), which also
covers the schema push a release touching `server/db/schema.js` still needs.
