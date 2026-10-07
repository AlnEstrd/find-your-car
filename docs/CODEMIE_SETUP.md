# Getting CodeMie keys and tokens

This guide shows how to get the three values Find Your Car needs to talk to an LLM through [AI/Run CodeMie](https://docs.codemie.ai/):

```
CODEMIE_API_URL=   # base URL; the app calls {CODEMIE_API_URL}/chat/completions
CODEMIE_API_KEY=   # sent as "Authorization: Bearer <key>"
CODEMIE_MODEL=     # a model ID your CodeMie project offers
```

All three are optional. If you leave the URL or key empty, the app runs in **offline demo mode**.

> ⚠️ Never commit real keys or tokens. `.env` is already in `.gitignore`; keep it that way.

---

## Pick a route

| Route | What you get | Best for |
|---|---|---|
| **A. Local CodeMie proxy (SSO)** | a local URL + the fixed key `codemie-proxy` | Laptop dev and demos, if you have a CodeMie SSO login |
| **B. LiteLLM API key** | a gateway URL + an `sk-...` key | Servers, shared demos, anything long-running |
| **C. JWT bearer token** | a short-lived JWT | CI pipelines and service accounts |

If you aren't sure, start with **A**.

---

## Prerequisites: install the CodeMie CLI

Routes A and C use the CodeMie CLI (`@codemieai/code`). It needs Node.js 20+.

```bash
npm install -g @codemieai/code
codemie --version
```

There are also install scripts for macOS, Linux, WSL and Windows in the [codemie-code repo](https://github.com/codemie-ai/codemie-code#installation).

---

## Route A: local CodeMie proxy with SSO (recommended)

Your SSO credentials stay in the CodeMie CLI, which runs a local OpenAI-compatible proxy. The app talks to that proxy, so it never sees your real token.

### 1. Log in with SSO

```bash
codemie setup
```

The wizard opens your browser for SSO, asks you to pick a project if you have more than one, and checks the connection. Credentials are saved to `~/.codemie/codemie-cli.config.json`, with the tokens in your system keychain.

To log in again later without the wizard:

```bash
codemie profile login --url https://<your-codemie-host>
codemie profile status     # shows whether you're logged in, when the token expires, and which models you can use
```

### 2. Start the proxy and find its port

```bash
codemie proxy start
codemie proxy status       # shows the port the daemon is listening on (for example 4001)
```

### 3. Fill in `.env`

```
CODEMIE_API_URL=http://127.0.0.1:4001/v1
CODEMIE_API_KEY=codemie-proxy
CODEMIE_MODEL=<a model ID from `codemie profile status`>
```

- `codemie-proxy` is a fixed placeholder key the local proxy expects. It isn't a secret; the proxy adds your SSO credentials itself.
- Use the port that `codemie proxy status` prints. It can differ from `4001` if that port was taken.
- Copy the model ID exactly as `codemie profile status` lists it.

> The proxy is documented for VS Code, Claude Desktop and Codex clients. Using it from your own app works the same way (OpenAI-compatible, `/v1/...` paths), but run the curl test below to confirm it works for you before a demo.

---

## Route B: LiteLLM API key

Many CodeMie deployments put their models behind a **LiteLLM** gateway. A LiteLLM virtual key works with any OpenAI-compatible client and doesn't expire with your SSO session, so it's the better choice for a deployed server.

1. Ask your CodeMie / platform admin for:
   - the **LiteLLM gateway base URL** (for example `https://litellm.<your-company>.com`)
   - a **virtual API key** (starts with `sk-`), ideally scoped to this project with a budget
   - the **model names** the key is allowed to call
2. Fill in `.env`:

   ```
   CODEMIE_API_URL=https://litellm.<your-company>.com/v1
   CODEMIE_API_KEY=sk-...
   CODEMIE_MODEL=gpt-4o
   ```

Some CodeMie instances also let you see or create LLM keys in the web UI under your profile, **Integrations** or **Settings**. The menu names vary by deployment and version, so check [docs.codemie.ai](https://docs.codemie.ai/) for your instance.

---

## Route C: JWT bearer token (CI / service accounts)

For pipelines where nobody can do a browser login, CodeMie accepts a **JWT bearer token** from your organization's auth provider (for example a Keycloak or OIDC client-credentials flow your admin sets up).

```bash
# Example: get a token from your auth provider
TOKEN=$(curl -s https://auth.example.com/token | jq -r .access_token)

# Check its format: a JWT has 3 parts (header.payload.signature)
echo "$TOKEN" | awk -F. '{print NF}'     # should print 3

export CODEMIE_JWT_TOKEN="$TOKEN"
codemie doctor                            # checks the token and warns if it expires within 7 days
```

To use it with this app, pass it as the key for the CodeMie host your admin gives you:

```
CODEMIE_API_URL=https://<your-codemie-host>/<llm-proxy-path>
CODEMIE_API_KEY=<JWT>
```

JWTs are short-lived and **do not refresh automatically**, so get a new one for each run. Store it as a CI secret (for example `secrets.CODEMIE_JWT_TOKEN` in GitHub Actions), never in the repo.

---

## Test your values before starting the app

The app sends exactly this request, so if it works here it will work in the app:

```bash
set -a; source .env; set +a

curl -sS "$CODEMIE_API_URL/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CODEMIE_API_KEY" \
  -d "{\"model\":\"$CODEMIE_MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Say hi\"}]}"
```

You should get JSON with `choices[0].message.content`. Then run:

```bash
npm start
```

The startup log should say `LLM: CodeMie (<model>)` rather than `offline mode`.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| App says `offline mode` | `CODEMIE_API_URL` or `CODEMIE_API_KEY` is empty | Check `.env` is in the project root and restart the app |
| `401` from `127.0.0.1` | Wrong local key | Use exactly `codemie-proxy` (route A) |
| `401` / `403` from upstream | SSO session or JWT expired | `codemie profile refresh` (or `codemie profile login`), then `codemie proxy stop && codemie proxy start`. For JWT, get a new token |
| `404` | Path is wrong | Make sure the URL ends where `/chat/completions` should be appended (usually `.../v1`), with no trailing `/chat/completions` |
| `405 Not Allowed` | URL points to the CodeMie host but not to the API route | Check the host *and* path with your admin; see `~/.codemie/logs/` for the URL the CLI used |
| `model not found` | Model ID isn't enabled for your project or key | Run `codemie profile status` or ask your admin for allowed models |
| Connection refused on localhost | Proxy not running | `codemie proxy start`, then `codemie proxy status` |
| TLS / certificate errors | Corporate self-signed certificates | Set `NODE_EXTRA_CA_CERTS=/path/to/corp-ca.pem` before `npm start` |
| Anything else | | `codemie doctor` runs a full diagnostic |

### Handy commands

```bash
codemie setup              # first-time wizard (SSO, project, health check)
codemie profile status     # login state, token expiry, available models
codemie profile refresh    # extend the SSO session
codemie profile logout     # clear credentials
codemie proxy start|stop|status
codemie doctor             # diagnostics
```

## References

- CodeMie docs: https://docs.codemie.ai/
- CodeMie CLI: https://github.com/codemie-ai/codemie-code
- CLI authentication guide: https://github.com/codemie-ai/codemie-code/blob/main/docs/AUTHENTICATION.md
- CLI commands (proxy, profile, doctor): https://github.com/codemie-ai/codemie-code/blob/main/docs/COMMANDS.md
