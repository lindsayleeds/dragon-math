#!/usr/bin/env bash
#
# One-time (but re-runnable) setup of a dragon-math target box:
#
#   1. the /srv/dragon-math release layout
#   2. shared/.env (secrets — supplied by the operator, never in this repo)
#   3. the nginx site, from deploy/nginx/site.conf.template
#   4. a Let's Encrypt certificate via certbot certonly --webroot
#
# Re-running is safe and is the intended way to apply a template change:
# directories are created only if missing, the certificate is reused until it is
# near expiry, and nginx is validated before every reload.
#
# It does NOT deploy code — that is deploy/release.sh.
#
# Usage:
#   deploy/provision.sh -t test [--env-file PATH] [--skip-tls]
#
#   --env-file PATH   install PATH as shared/.env on the target (mode 600).
#                     Omit once it is in place; provision will then require it.
#   --skip-tls        set up nginx over HTTP only (no certbot). For a box whose
#                     DNS has not propagated yet.

. "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

TARGET=""; ENV_FILE=""; SKIP_TLS=0
while [ $# -gt 0 ]; do
  case "$1" in
    -t|--target)   TARGET="${2:?}"; shift 2 ;;
    --env-file)    ENV_FILE="${2:?}"; shift 2 ;;
    --skip-tls)    SKIP_TLS=1; shift ;;
    -h|--help)     sed -n '2,25p' "$0"; exit 0 ;;
    *)             die "unknown argument '$1'" ;;
  esac
done
[ -n "$TARGET" ] || die "usage: $0 -t <target> [--env-file PATH] [--skip-tls]"

load_target "$TARGET"
require_ssh

# The ACME webroot must live OUTSIDE shared/: shared/ is mode 700 because it
# holds secrets, and nginx (www-data) cannot traverse into it.
export DM_ACME_WEBROOT="$DM_ROOT/acme"

say "provisioning $DM_HOSTNAME on $DM_SSH_HOST ($DM_ENVIRONMENT)"

# ── 1. release layout ────────────────────────────────────────────────────────
say "creating release layout under $DM_ROOT"
rbash <<'REMOTE'
sudo mkdir -p "$DM_RELEASES" "$DM_SHARED" "$DM_ROOT/acme"
sudo chown -R "$(id -u):$(id -g)" "$DM_ROOT"
# nginx runs as www-data and has to traverse $DM_ROOT/current/dist to serve the
# site and $DM_ROOT/acme to answer an http-01 challenge, so these are 755.
# Only shared/ is owner-only, and it is the only thing holding secrets.
chmod 755 "$DM_ROOT"
chmod 755 "$DM_RELEASES"
chmod 755 "$DM_ROOT/acme"
chmod 700 "$DM_SHARED"
echo "layout:"; ls -la "$DM_ROOT"
REMOTE
ok "layout ready"

# ── 2. shared/.env ───────────────────────────────────────────────────────────
if [ -n "$ENV_FILE" ]; then
  [ -f "$ENV_FILE" ] || die "--env-file '$ENV_FILE' does not exist"
  # Refuse to ship a live Stripe key to a non-production box, whatever the
  # operator thinks the file contains.
  # Comments are stripped first: a file that merely *documents* the live-key
  # prefixes must not trip the guard, only a real assignment.
  if [ "${DM_ENVIRONMENT:-}" != "production" ] && \
     grep -vE '^[[:space:]]*#' "$ENV_FILE" | grep -qE '=.*(sk|pk|rk)_live_'; then
    die "refusing: '$ENV_FILE' contains a LIVE Stripe key and target is '$DM_ENVIRONMENT'"
  fi
  if [ "${DM_ENVIRONMENT:-}" != "production" ] && grep -qE '^ENABLE_CRON=(1|true|yes|on)\b' "$ENV_FILE"; then
    die "refusing: '$ENV_FILE' enables cron on non-production target '$DM_ENVIRONMENT'"
  fi
  say "installing shared/.env (mode 600)"
  # Piped over ssh so the secret never becomes a command-line argument.
  rsh "umask 077 && cat > $(qq "$DM_SHARED/.env") && chmod 600 $(qq "$DM_SHARED/.env")" < "$ENV_FILE"
  ok "shared/.env installed ($(wc -l < "$ENV_FILE") lines, contents not logged)"
else
  rbash <<'REMOTE'
[ -f "$DM_SHARED/.env" ] || { echo "shared/.env is missing — pass --env-file" >&2; exit 1; }
echo "shared/.env present, mode $(stat -c %a "$DM_SHARED/.env")"
REMOTE
  ok "shared/.env already present"
fi

# Independent verification of the two settings that can do real-world damage.
say "verifying the dangerous settings in shared/.env"
rbash <<'REMOTE'
# LAST assignment wins, because that is what dotenv does when a key appears
# twice — reading the first one would report a setting the app never uses.
env_get() { grep "^$1=" "$DM_SHARED/.env" 2>/dev/null | tail -1 | cut -d= -f2- || true; }
fail=0

cron="$(env_get ENABLE_CRON)"
case "$cron" in
  0|false|no|off) echo "  ENABLE_CRON=$cron (cron disabled)" ;;
  "")             echo "  ENABLE_CRON unset — NODE_ENV=production would ARM cron" >&2; fail=1 ;;
  *)              echo "  ENABLE_CRON=$cron — cron would be ARMED" >&2; fail=1 ;;
esac

if grep -vE '^[[:space:]]*#' "$DM_SHARED/.env" | grep -qE '=.*(sk|pk|rk)_live_'; then
  echo "  LIVE Stripe key present in shared/.env" >&2; fail=1
else
  echo "  no live Stripe key in shared/.env"
fi

# DATABASE_URL host/project only — never the password.
db="$(env_get DATABASE_URL)"
if [ -n "$db" ]; then
  echo "  DATABASE_URL user/host: $(printf '%s' "$db" | sed -E 's|^postgresql://([^:]+):[^@]+@|\1@|')"
else
  echo "  DATABASE_URL is empty" >&2; fail=1
fi

[ "$fail" -eq 0 ] || { echo "shared/.env failed its safety checks" >&2; exit 1; }
REMOTE
ok "shared/.env safety checks passed"

# ── 3. nginx + 4. TLS ────────────────────────────────────────────────────────
NGINX_AVAIL="/etc/nginx/sites-available/$DM_HOSTNAME"
NGINX_LINK="/etc/nginx/sites-enabled/$DM_HOSTNAME"

# $1 = template path, $2 = label. Renders locally, ships it, validates, reloads.
#
# camelot is a SHARED box: a config nginx rejects must never be left enabled,
# because the next `systemctl reload nginx` — or a reboot, or the certbot deploy
# hook installed below — then fails for every site on the machine, not just ours.
# So the previous sites-available file is copied aside first and put back if
# nginx -t fails; on a fresh host there is nothing to preserve, and the
# half-installed file plus its symlink are removed instead. Either way the box
# ends up exactly as it was, and nothing is reloaded unless validation passed.
#
# A rejected config genuinely has to be enabled to be validated: nginx -t only
# parses what nginx.conf includes, so testing an unlinked file would pass
# vacuously. Hence install-then-restore rather than validate-then-enable.
install_nginx_conf() {
  local tpl="$1" label="$2" rendered
  rendered="$(mktemp)"; trap 'rm -f "$rendered"' RETURN
  render_template "$tpl" > "$rendered"
  say "installing nginx config ($label)"

  # Staged under $DM_ROOT first so the rendered file arrives over stdin (no
  # config content on a command line) while the swap logic below stays one
  # snippet that can undo itself.
  local staged="$DM_ROOT/.nginx-staged.conf"
  rsh "umask 022 && cat > $(qq "$staged")" < "$rendered" \
    || die "could not stage the rendered nginx config on the target ($label)"

  rbash staged="$staged" avail="$NGINX_AVAIL" link="$NGINX_LINK" label="$label" <<'REMOTE' \
    || die "nginx config not installed ($label) — the previous config is still in place"
backup=""
had_link=no
if [ -f "$avail" ]; then
  backup="$(mktemp)"
  cat "$avail" > "$backup"
fi
if [ -L "$link" ] || [ -e "$link" ]; then had_link=yes; fi

restore_previous() {
  if [ -n "$backup" ]; then
    sudo tee "$avail" >/dev/null < "$backup"
  else
    sudo rm -f "$avail"
  fi
  if [ "$had_link" = "no" ]; then sudo rm -f "$link"; fi
}

sudo tee "$avail" >/dev/null < "$staged"
sudo ln -sfn "$avail" "$link"
rm -f "$staged"

if ! sudo nginx -t; then
  echo "nginx rejected the rendered config ($label) — undoing the install" >&2
  restore_previous
  if sudo nginx -t >/dev/null 2>&1; then
    echo "previous nginx state restored and valid; nothing was reloaded" >&2
  else
    echo "nginx is STILL rejecting its config after the restore — inspect $avail by hand" >&2
  fi
  if [ -n "$backup" ]; then rm -f "$backup"; fi
  exit 1
fi
if [ -n "$backup" ]; then rm -f "$backup"; fi

sudo systemctl reload nginx
REMOTE
  ok "nginx reloaded ($label)"
}

cert_live="/etc/letsencrypt/live/$DM_HOSTNAME/fullchain.pem"

# One -d per name in DM_SERVER_NAMES, DM_HOSTNAME first so the lineage keeps its
# name and cert_live above stays correct.
#
# Passing the SAME set on every run is what makes this safe to re-run against an
# existing certificate: certbot matches the request to a lineage by its domain
# set, so omitting an alias here would not "leave it alone" — it would issue a
# reduced certificate and silently stop serving that alias. This is why the
# aliases live in the target file rather than being typed at the prompt once.
CERT_DOMAIN_ARGS=""
for _n in $DM_SERVER_NAMES; do CERT_DOMAIN_ARGS+=" -d $(qq "$_n")"; done

have_cert=0
rsh "sudo test -f $(qq "$cert_live")" 2>/dev/null && have_cert=1 || true

if [ "$SKIP_TLS" = "1" ]; then
  install_nginx_conf "$DM_DEPLOY_DIR/nginx/bootstrap-http.conf.template" "http-only, --skip-tls"
  warn "TLS skipped — re-run without --skip-tls once DNS resolves to this box"
  exit 0
fi

if [ "$have_cert" = "0" ]; then
  say "no certificate yet — installing HTTP-only config for the ACME challenge"
  install_nginx_conf "$DM_DEPLOY_DIR/nginx/bootstrap-http.conf.template" "http-only bootstrap"

  say "requesting certificate for $DM_SERVER_NAMES"
  # Fails loudly on a DNS mismatch. If public DNS is still cached to the old
  # host, wait for the TTL and re-run — do not change DNS.
  if ! rsh "sudo certbot certonly --webroot -w $(qq "$DM_ROOT/acme") \
             $CERT_DOMAIN_ARGS --non-interactive --agree-tos \
              -m $(qq "${DM_CERTBOT_EMAIL:-admin@$DM_HOSTNAME}") \
              --keep-until-expiring"; then
    die "certbot failed. If it reported a DNS/challenge mismatch, public resolvers
     may still be serving a cached record for $DM_HOSTNAME. Wait for the TTL to
     expire and re-run this script — do not repoint DNS."
  fi
  ok "certificate issued"
else
  say "certificate already present — renewing only if near expiry"
  rsh "sudo certbot certonly --webroot -w $(qq "$DM_ROOT/acme") \
        $CERT_DOMAIN_ARGS --non-interactive --agree-tos \
         -m $(qq "${DM_CERTBOT_EMAIL:-admin@$DM_HOSTNAME}") \
         --keep-until-expiring" >/dev/null
  ok "certificate valid"
fi

# Full TLS config last, so the version-controlled template — not certbot — is
# what ends up on the box.
install_nginx_conf "$DM_DEPLOY_DIR/nginx/site.conf.template" "full TLS site"

# Renewal reload hook.
#
# We deliberately use `certonly` so the nginx config stays owned by the template
# in this repo instead of being rewritten by certbot's installer. The cost is
# that our renewal has no `installer =` line, so certbot renews the certificate
# on disk and nothing tells the running nginx to pick it up — the site would
# keep serving the expired cert until the next unrelated reload. A deploy hook
# closes that gap. It is shared by every cert on the box and an extra reload is
# harmless, so it is written idempotently rather than per-certificate.
say "installing the certbot deploy hook that reloads nginx"
rsh "sudo mkdir -p /etc/letsencrypt/renewal-hooks/deploy && \
     sudo tee /etc/letsencrypt/renewal-hooks/deploy/00-reload-nginx.sh >/dev/null && \
     sudo chmod 755 /etc/letsencrypt/renewal-hooks/deploy/00-reload-nginx.sh" <<'HOOK'
#!/bin/sh
# Installed by dragon-math deploy/provision.sh.
# Certbot runs every executable in this directory after a successful renewal.
# Our site is issued with `certonly` (no certbot installer), so without this the
# renewed certificate would sit on disk unserved until nginx happened to reload.
set -e
nginx -t && systemctl reload nginx
HOOK
ok "renewal hook installed"

say "certificate summary"
rsh "sudo certbot certificates --cert-name $(qq "$DM_HOSTNAME") 2>/dev/null \
     | grep -E 'Certificate Name|Domains|Expiry' || true"

cat <<EOF

$( ok "provision complete for $DM_HOSTNAME" )

Next: deploy code with
    deploy/release.sh -t $TARGET --ref <git-ref>
EOF
