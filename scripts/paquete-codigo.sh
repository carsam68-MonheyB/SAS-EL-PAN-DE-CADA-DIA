#!/usr/bin/env bash
# Paquete del código de la versión actual (diseño 1.4-B): solo lo que está en
# git, sin node_modules, .env ni secretos. Uso: bash scripts/paquete-codigo.sh [carpeta]
set -euo pipefail
destino="${1:-.}"
version="$(git describe --tags --always)"
archivo="$destino/sas-el-pan-de-cada-dia-$(date +%Y%m%d)-$version.zip"
git archive --format=zip -o "$archivo" HEAD
echo "Paquete: $archivo"
