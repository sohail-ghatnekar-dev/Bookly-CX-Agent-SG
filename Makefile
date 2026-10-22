.PHONY: doctor db serve test eval

# Secret patterns are written with a bracketed character so this file never matches itself.
SECRET_PATTERNS := sk[-]ant-|sb[_]secret_|InNlcnZpY2Vfcm9[s]|ZXJ2aWNlX3JvbGU[i]|c2VydmljZV9yb2x[l]

IGNORED := .env .env.local supabase/.env supabase/.env.hosted evals/.env evals/.env.remote \
	ios/Bookly/Config.xcconfig supabase/.temp/x evals/results/latest.json
NOT_IGNORED := supabase/.env.example evals/.env.example evals/results/.gitkeep \
	ios/Bookly/Config.example.xcconfig

# Checks files, variables, and ignore rules. Prints names only, never values.
doctor:
	@fail=0; \
	ok() { printf '  ok    %s\n' "$$1"; }; \
	bad() { printf '  FAIL  %s\n' "$$1"; fail=1; }; \
	has_var() { grep -qE "^[[:space:]]*$$2[[:space:]]*=[[:space:]]*[^[:space:]]" "$$1" 2>/dev/null; }; \
	need_vars() { f=$$1; shift; \
	  if [ ! -f "$$f" ]; then bad "$$f is missing"; return; fi; \
	  for v in "$$@"; do if has_var "$$f" "$$v"; then ok "$$f: $$v set"; else bad "$$f: $$v missing or empty"; fi; done; }; \
	echo "Files"; \
	for f in supabase/config.toml supabase/migrations/0001_schema.sql supabase/seed.sql; do \
	  if [ -s "$$f" ]; then ok "$$f"; else bad "$$f is missing"; fi; done; \
	echo "Variables"; \
	if [ ! -f supabase/.env.hosted ] && [ ! -f supabase/.env ]; then \
	  bad "add supabase/.env.hosted (cloud) or supabase/.env (local) from supabase/.env.example"; fi; \
	if [ -f supabase/.env.hosted ]; then \
	  need_vars supabase/.env.hosted ANTHROPIC_API_KEY ANTHROPIC_MODEL ALLOW_REDTEAM; \
	  if grep -qE '^ALLOW_REDTEAM=false[[:space:]]*$$' supabase/.env.hosted; then ok "supabase/.env.hosted: ALLOW_REDTEAM is false"; \
	  else bad "supabase/.env.hosted: ALLOW_REDTEAM must be false"; fi; \
	else printf '  skip  supabase/.env.hosted (only needed for the cloud)\n'; fi; \
	if [ -f supabase/.env ]; then need_vars supabase/.env ANTHROPIC_API_KEY ANTHROPIC_MODEL ALLOW_REDTEAM; \
	else printf '  skip  supabase/.env (only needed to run locally)\n'; fi; \
	for f in evals/.env.remote evals/.env; do \
	  if [ -f "$$f" ]; then need_vars "$$f" SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY; \
	  else printf '  skip  %s (only needed for evals)\n' "$$f"; fi; done; \
	need_vars ios/Bookly/Config.xcconfig SUPABASE_URL SUPABASE_ANON_KEY; \
	echo "Local config"; \
	if grep -qE '^enable_anonymous_sign_ins[[:space:]]*=[[:space:]]*true' supabase/config.toml; then ok "anonymous sign-ins enabled"; \
	else bad "anonymous sign-ins not enabled in supabase/config.toml"; fi; \
	if awk '/^\[functions\.agent\]/{f=1;next} /^\[/{f=0} f && /^verify_jwt[[:space:]]*=[[:space:]]*true/{x=1} END{exit !x}' supabase/config.toml; \
	then ok "functions.agent verify_jwt = true"; else bad "functions.agent verify_jwt is not true"; fi; \
	echo "Git ignore rules"; \
	for p in $(IGNORED); do if git check-ignore -q "$$p"; then ok "ignored: $$p"; else bad "NOT ignored: $$p"; fi; done; \
	for p in $(NOT_IGNORED); do if git check-ignore -q "$$p"; then bad "wrongly ignored: $$p"; else ok "tracked: $$p"; fi; done; \
	echo "Secret scan (tracked and committable files, plus iOS config)"; \
	hits=$$(git grep --untracked -lIE '$(SECRET_PATTERNS)' 2>/dev/null); \
	for f in evals/.env evals/.env.remote; do \
	  if [ -f "$$f" ]; then \
	    key=$$(sed -n 's/^SUPABASE_SERVICE_ROLE_KEY=//p' "$$f"); \
	    if [ -n "$$key" ]; then hits="$$hits $$(git grep --untracked -lIF -e "$$key" 2>/dev/null)"; \
	      if [ -f ios/Bookly/Config.xcconfig ] && grep -qF -e "$$key" ios/Bookly/Config.xcconfig; then hits="$$hits ios/Bookly/Config.xcconfig"; fi; fi; \
	  fi; done; \
	if [ -f ios/Bookly/Config.xcconfig ] && grep -qE '$(SECRET_PATTERNS)' ios/Bookly/Config.xcconfig; then hits="$$hits ios/Bookly/Config.xcconfig"; fi; \
	hits=$$(echo $$hits | tr ' ' '\n' | sort -u); hits=$$(echo $$hits); \
	if [ -n "$$hits" ]; then bad "possible secret in: $$hits"; else ok "no secrets found"; fi; \
	echo; \
	if [ $$fail -ne 0 ]; then echo "doctor: FAILED"; exit 1; else echo "doctor: all checks passed"; fi

db:
	supabase db reset

serve:
	supabase functions serve agent --env-file supabase/.env

test:
	deno test supabase/functions/agent/

eval:
	deno run -A evals/run.ts $(ARGS)
