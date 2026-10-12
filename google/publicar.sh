#!/bin/bash
# Publica google/campo.gs no Apps Script "Cadastro pelo celular" sem abrir o navegador (clasp, autorizado uma vez com "clasp login").
# Atualiza a MESMA implantação: o endereço /exec usado pelo sistema e pelo aplicativo não muda.
# Uso: ./google/publicar.sh "descrição da versão"
set -e
cd "$(dirname "$0")"
PASTA=/c/Users/Admin/apps-script-campo                      # .clasp.json com o scriptId (fora do repositório)
IMPLANTACAO=AKfycbwgS-bhUfuCZXuUaB6ACA4EdwCXVKFO2_e8MhgGfH1B_79buYM1HVGKWcPHBspaWufm0Q
node -e "new Function(require('fs').readFileSync('campo.gs','utf8'))"   # não publica código com erro de sintaxe
cp campo.gs "$PASTA/Código.js"
cd "$PASTA"
clasp push -f
clasp deploy -i "$IMPLANTACAO" -d "${1:-atualização}"
clasp deployments | grep "$IMPLANTACAO"
