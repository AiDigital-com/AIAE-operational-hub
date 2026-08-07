#!/usr/bin/env bash
#
# deploy-env.sh — maps PRD_*-prefixed overrides onto their canonical names.
#
# Sourced (never executed) by replit-build.sh and replit-run.sh. The .replit
# [deployment] section is the only caller of those two scripts; the Replit
# workspace boots the app through [workflows] instead and never sources this
# file. So the base variables hold the DEV Clerk instance and are what the
# workspace uses, while the published app gets the PRD_ values.
#
# To give the published app its own value for <NAME>, set PRD_<NAME> in
# Replit Configurations (or Secrets, for the secret key). Leave PRD_<NAME>
# unset to share the base value across both environments.
#
# Sourced with `set -u` active, hence the `:-` guards on indirect lookups.

DEPLOY_OVERRIDABLE_VARS=(
	CLERK_PUBLISHABLE_KEY
	CLERK_SECRET_KEY
	AUTH_AUTHORIZED_PARTIES
	APP_SECURITY_CSP_FRAME_ANCESTORS
)

for _deploy_var in "${DEPLOY_OVERRIDABLE_VARS[@]}"; do
	_deploy_src="PRD_${_deploy_var}"
	if [ -n "${!_deploy_src:-}" ]; then
		export "${_deploy_var}=${!_deploy_src}"
		# Log names only — CLERK_SECRET_KEY must never reach the build log.
		echo "[deploy-env] ${_deploy_var} <- ${_deploy_src}"
	else
		echo "[deploy-env] WARNING: ${_deploy_src} is unset;" \
			"the published app will use the base ${_deploy_var}" >&2
	fi
done

unset _deploy_var _deploy_src
