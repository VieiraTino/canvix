#!/bin/sh
# Atualiza a lista de IPs dos conectores do ChatGPT (MCP) e recarrega o nginx.
# Se o download ou o nginx -t falharem, mantem a lista anterior.
set -eu
out=/etc/nginx/snippets/openai-connectors-allow.conf
tmp=$(mktemp)
curl -fsS -m 20 https://openai.com/chatgpt-connectors.json \
  | python3 -c "import json,sys; d=json.load(sys.stdin); [print(\"allow %s;\" % (p.get(\"ipv4Prefix\") or p.get(\"ipv6Prefix\"))) for p in d[\"prefixes\"]]" > "$tmp"
n=$(wc -l < "$tmp")
[ "$n" -gt 10 ] || { echo "lista suspeita ($n linhas), nao altero"; rm -f "$tmp"; exit 1; }
cp "$out" "$out.bak" 2>/dev/null || true
{ echo "# IPs dos conectores do ChatGPT (openai.com/chatgpt-connectors.json). Gerado por $0."; cat "$tmp"; } > "$out"
rm -f "$tmp"
if nginx -t >/dev/null 2>&1; then systemctl reload nginx; else [ -f "$out.bak" ] && cp "$out.bak" "$out"; echo "nginx -t falhou, reposta a lista anterior"; exit 1; fi
echo "ok: $n prefixos"
